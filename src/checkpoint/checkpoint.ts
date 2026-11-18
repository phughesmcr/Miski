import type { Entity } from "@/entity/entity.ts";
import { CapacityError, EntityNotFoundError } from "@/errors.ts";
import { cloneFieldValue, isFieldDescriptor } from "@/schema/field.ts";
import type { DynamicComponent } from "@/types/component.ts";

/** Entity collection accepted by {@link World.captureCheckpoint}. */
export type CheckpointEntitySet =
  | Iterable<Entity>
  | { forEach(fn: (entity: Entity) => void): void };

type CapturedComponent =
  | { readonly present: false }
  | { readonly present: true; readonly properties?: Readonly<Record<string, unknown>> };

type CapturedEntity = {
  readonly entity: Entity;
  readonly components: readonly CapturedComponent[];
};

type CheckpointData = {
  readonly owner: CheckpointWorld;
  readonly components: readonly DynamicComponent[];
  readonly entities: readonly CapturedEntity[];
};

/** Minimal world surface required by checkpoint capture/apply. */
export interface CheckpointWorld {
  isEntityAlive(entity: Entity): boolean;
  entityHasComponent(entity: Entity, component: DynamicComponent): boolean;
  getComponentInstance(component: DynamicComponent): {
    get(entity: Entity, key: string): unknown;
    type: { schema: Record<string, unknown> | null };
  };
  getOwnerCount(component: DynamicComponent): number;
  validateComponentData(component: DynamicComponent, properties: Record<string, unknown> | undefined): void;
  setComponentEntityData(entity: Entity, component: DynamicComponent, properties: Record<string, unknown>): void;
  addComponentToEntity(
    entity: Entity,
    component: DynamicComponent,
    properties?: Record<string, unknown>,
  ): void;
  removeComponentFromEntity(entity: Entity, component: DynamicComponent): void;
}

const checkpointData = new WeakMap<ComponentCheckpoint, CheckpointData>();

/** Fields a checkpoint must rework on every apply: entity refs (may have died) and objects with a clone hook. */
type ApplyFixups = {
  readonly entityKeys: readonly string[];
  readonly cloneKeys: readonly string[];
};

/** @returns the apply-time fixups for a component, or `null` when its captured values apply as is */
function getApplyFixups(schema: Record<string, unknown> | null): ApplyFixups | null {
  if (schema === null) return null;
  const entityKeys: string[] = [];
  const cloneKeys: string[] = [];
  for (const key of Object.keys(schema)) {
    const property = schema[key];
    if (!isFieldDescriptor(property)) continue;
    if (property.kind === "entity") entityKeys.push(key);
    else if (property.kind === "object" && property.clone !== undefined) cloneKeys.push(key);
  }
  return entityKeys.length === 0 && cloneKeys.length === 0 ? null : { entityKeys, cloneKeys };
}

/**
 * Build the payload one apply writes: dead entity refs become `null` and objects are cloned again, so a reused
 * checkpoint never shares objects with the world.
 */
function preparePayload(
  world: CheckpointWorld,
  schema: Record<string, unknown>,
  fixups: ApplyFixups,
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...properties };
  for (const key of fixups.entityKeys) {
    const target = payload[key];
    if (target !== null && !world.isEntityAlive(target as Entity)) payload[key] = null;
  }
  for (const key of fixups.cloneKeys) payload[key] = cloneFieldValue(schema[key], payload[key]);
  return payload;
}

/**
 * Reusable capture of selected component membership and values for an entity set.
 */
export interface ComponentCheckpoint {
  /** Number of distinct captured entity handles. */
  readonly entityCount: number;

  /** Component definitions captured, in request order with duplicates removed. */
  readonly components: readonly DynamicComponent[];
}

class ComponentCheckpointImpl implements ComponentCheckpoint {
  constructor(data: CheckpointData) {
    checkpointData.set(this, data);
  }

  get entityCount(): number {
    return requireData(this).entities.length;
  }

  get components(): readonly DynamicComponent[] {
    return requireData(this).components;
  }
}

/** Capture membership and property values for only `components` across a fixed entity set. */
export function captureComponentCheckpoint(
  world: CheckpointWorld,
  entitySet: CheckpointEntitySet,
  requestedComponents: readonly DynamicComponent[],
): ComponentCheckpoint {
  const components = Object.freeze([...new Set(requestedComponents)]);
  const keys = components.map((component) => {
    const instance = world.getComponentInstance(component);
    const schema = instance.type.schema;
    return schema === null ? [] : Object.keys(schema);
  });
  const entities: CapturedEntity[] = [];
  const seen = new Set<Entity>();

  forEachEntity(entitySet, (entity) => {
    if (seen.has(entity)) return;
    if (!world.isEntityAlive(entity)) throw new EntityNotFoundError(`Entity ${entity} is not active.`);
    seen.add(entity);

    const captured = components.map((component, index): CapturedComponent => {
      if (!world.entityHasComponent(entity, component)) return { present: false };
      const storage = world.getComponentInstance(component);
      if (storage.type.schema === null) return { present: true };
      const schema = storage.type.schema;
      const properties: Record<string, unknown> = {};
      for (const key of keys[index]!) properties[key] = cloneFieldValue(schema[key], storage.get(entity, key));
      return { present: true, properties: Object.freeze(properties) };
    });
    entities.push({ entity, components: Object.freeze(captured) });
  });

  const data: CheckpointData = {
    owner: world,
    components,
    entities: Object.freeze(entities),
  };
  return new ComponentCheckpointImpl(data);
}

/** Restore a component-subset checkpoint captured from this world. */
export function applyComponentCheckpoint(world: CheckpointWorld, checkpoint: ComponentCheckpoint): void {
  const data = requireData(checkpoint);
  if (data.owner !== world) {
    throw new Error("Cannot apply a component checkpoint to a different world.");
  }

  for (const { entity } of data.entities) {
    if (!world.isEntityAlive(entity)) throw new EntityNotFoundError(`Entity ${entity} is not active.`);
  }

  // Payloads per entity, per component: captured values, or reworked copies for entity / cloned object fields.
  const payloads: (Readonly<Record<string, unknown>> | undefined)[][] = data.entities.map(() => []);

  // Validate the final ownership counts and every payload before any part of the checkpoint changes.
  for (let index = 0; index < data.components.length; index++) {
    const component = data.components[index]!;
    const schema = component.schema as Record<string, unknown> | null;
    const fixups = getApplyFixups(schema);
    let finalOwners = world.getOwnerCount(component);
    for (let e = 0; e < data.entities.length; e++) {
      const { entity, components } = data.entities[e]!;
      const captured = components[index]!;
      const present = world.entityHasComponent(entity, component);
      finalOwners += Number(captured.present) - Number(present);
      if (!captured.present) continue;
      const properties = captured.properties;
      const payload = fixups === null || properties === undefined ?
        properties :
        preparePayload(world, schema!, fixups, properties);
      world.validateComponentData(component, payload as Record<string, unknown> | undefined);
      payloads[e]![index] = payload;
    }
    const cap = component.maxEntities;
    if (cap !== null && cap !== undefined && finalOwners > cap) {
      throw new CapacityError(`Component ${component.name} exceeds its maximum owner count.`);
    }
  }

  // Free capped memberships first, so application never depends on entity order.
  for (const { entity, components } of data.entities) {
    for (let index = 0; index < data.components.length; index++) {
      const component = data.components[index]!;
      if (!components[index]!.present && world.entityHasComponent(entity, component)) {
        world.removeComponentFromEntity(entity, component);
      }
    }
  }
  for (let e = 0; e < data.entities.length; e++) {
    const { entity, components } = data.entities[e]!;
    for (let index = 0; index < data.components.length; index++) {
      const component = data.components[index]!;
      if (!components[index]!.present) continue;
      const payload = payloads[e]![index] as Record<string, unknown> | undefined;
      if (!world.entityHasComponent(entity, component)) {
        world.addComponentToEntity(entity, component, payload);
      } else if (payload !== undefined) {
        world.setComponentEntityData(entity, component, payload);
      }
    }
  }
}

function requireData(checkpoint: ComponentCheckpoint): CheckpointData {
  const data = checkpointData.get(checkpoint);
  if (data === undefined) throw new TypeError("Invalid ComponentCheckpoint.");
  return data;
}

function forEachEntity(entitySet: CheckpointEntitySet, fn: (entity: Entity) => void): void {
  if (Symbol.iterator in Object(entitySet)) {
    for (const entity of entitySet as Iterable<Entity>) fn(entity);
    return;
  }
  (entitySet as { forEach(fn: (entity: Entity) => void): void }).forEach(fn);
}
