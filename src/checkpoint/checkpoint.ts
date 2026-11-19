import type { Entity } from "@/entity/entity.ts";
import { ArgumentError, CapacityError, EntityNotFoundError } from "@/errors.ts";
import { isFieldDescriptor } from "@/schema/field.ts";
import type { DynamicComponent } from "@/types/component.ts";

/** Entity collection accepted by {@link World.captureCheckpoint}. */
export type CheckpointEntitySet =
  | Iterable<Entity>
  | { forEach(fn: (entity: Entity) => void): void };

/** Ordered targets and pair data of one relation source. */
type CheckpointRelationPairs = {
  readonly targets: readonly Entity[];
  readonly data: readonly Readonly<Record<string, number>>[];
};

type CapturedComponent =
  | { readonly present: false; readonly pairs?: CheckpointRelationPairs }
  | {
    readonly present: true;
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly pairs?: CheckpointRelationPairs;
  };

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
  /** @returns `true` if `component` is a relation, whose pairs are captured instead of its presence tag */
  isRelation(component: DynamicComponent): boolean;
  captureRelationPairs(entity: Entity, component: DynamicComponent): CheckpointRelationPairs;
  /** Throw, without mutating, if restoring these pairs would fail. */
  preflightRelationPairs(
    component: DynamicComponent,
    entries: readonly { readonly entity: Entity; readonly pairs: CheckpointRelationPairs }[],
  ): void;
  restoreRelationPairs(entity: Entity, component: DynamicComponent, pairs: CheckpointRelationPairs): void;
}

/** Fields a checkpoint must rework on every apply: entity refs (may have died) and objects with a clone hook. */
type ApplyFixups = {
  readonly entityKeys: readonly string[];
  readonly cloneKeys: readonly string[];
  /** The clone hook of each {@link ApplyFixups.cloneKeys} entry, resolved once per component. */
  readonly clones: readonly CloneHook[];
};

type CloneHook = (value: unknown) => unknown;

/** @returns each key's object-field clone hook (`undefined` when the value is copied as is), resolved once per schema */
function getCloneHooks(schema: Record<string, unknown>, keys: readonly string[]): (CloneHook | undefined)[] {
  return keys.map((key) => {
    const property = schema[key];
    return isFieldDescriptor(property) && property.kind === "object" ?
      property.clone as CloneHook | undefined :
      undefined;
  });
}

/** @returns the apply-time fixups for a component, or `null` when its captured values apply as is */
function getApplyFixups(schema: Record<string, unknown> | null): ApplyFixups | null {
  if (schema === null) return null;
  const entityKeys: string[] = [];
  const cloneKeys: string[] = [];
  const clones: CloneHook[] = [];
  for (const key of Object.keys(schema)) {
    const property = schema[key];
    if (!isFieldDescriptor(property)) continue;
    if (property.kind === "entity") entityKeys.push(key);
    else if (property.kind === "object" && property.clone !== undefined) {
      cloneKeys.push(key);
      clones.push(property.clone as CloneHook);
    }
  }
  return entityKeys.length === 0 && cloneKeys.length === 0 ? null : { entityKeys, cloneKeys, clones };
}

/**
 * Build the payload one apply writes: dead entity refs become `null` and objects are cloned again, so a reused
 * checkpoint never shares objects with the world.
 */
function preparePayload(
  world: CheckpointWorld,
  fixups: ApplyFixups,
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...properties };
  for (const key of fixups.entityKeys) {
    const target = payload[key];
    if (target !== null && !world.isEntityAlive(target as Entity)) payload[key] = null;
  }
  const { cloneKeys, clones } = fixups;
  for (let i = 0; i < cloneKeys.length; i++) {
    const key = cloneKeys[i]!;
    const value = payload[key];
    if (value !== null) payload[key] = clones[i]!(value);
  }
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
  readonly #data: CheckpointData;

  constructor(data: CheckpointData) {
    this.#data = data;
  }

  get entityCount(): number {
    return this.#data.entities.length;
  }

  get components(): readonly DynamicComponent[] {
    return this.#data.components;
  }

  /** @returns the captured data of a checkpoint made by {@link captureComponentCheckpoint} */
  static dataOf(checkpoint: ComponentCheckpoint): CheckpointData {
    if (!(#data in (checkpoint as object))) throw new ArgumentError("Invalid ComponentCheckpoint.");
    return (checkpoint as ComponentCheckpointImpl).#data;
  }
}

/** Capture membership and property values for only `components` across a fixed entity set. */
export function captureComponentCheckpoint(
  world: CheckpointWorld,
  entitySet: CheckpointEntitySet,
  requestedComponents: readonly DynamicComponent[],
): ComponentCheckpoint {
  const components = Object.freeze([...new Set(requestedComponents)]);
  const relations = components.map((component) => world.isRelation(component));
  const keys = components.map((component) => {
    const instance = world.getComponentInstance(component);
    const schema = instance.type.schema;
    return schema === null ? [] : Object.keys(schema);
  });
  const cloneHooks = components.map((component, index) => {
    const schema = world.getComponentInstance(component).type.schema;
    return schema === null ? [] : getCloneHooks(schema, keys[index]!);
  });
  const entities: CapturedEntity[] = [];
  const seen = new Set<Entity>();

  forEachEntity(entitySet, (entity) => {
    if (seen.has(entity)) return;
    if (!world.isEntityAlive(entity)) throw new EntityNotFoundError(`Entity ${entity} is not active.`);
    seen.add(entity);

    const captured = components.map((component, index): CapturedComponent => {
      if (relations[index]) {
        const pairs = world.captureRelationPairs(entity, component);
        return pairs.targets.length === 0 ? { present: false, pairs } : { present: true, pairs };
      }
      if (!world.entityHasComponent(entity, component)) return { present: false };
      const storage = world.getComponentInstance(component);
      if (storage.type.schema === null) return { present: true };
      const properties: Record<string, unknown> = {};
      const componentKeys = keys[index]!;
      const componentClones = cloneHooks[index]!;
      for (let k = 0; k < componentKeys.length; k++) {
        const key = componentKeys[k]!;
        const value = storage.get(entity, key);
        const clone = componentClones[k];
        properties[key] = clone === undefined || value === null ? value : clone(value);
      }
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
  const data = ComponentCheckpointImpl.dataOf(checkpoint);
  if (data.owner !== world) {
    throw new ArgumentError("Cannot apply a component checkpoint to a different world.");
  }

  for (const { entity } of data.entities) {
    if (!world.isEntityAlive(entity)) throw new EntityNotFoundError(`Entity ${entity} is not active.`);
  }

  // Payloads per entity, per component: captured values, or reworked copies for entity / cloned object fields.
  const payloads: (Readonly<Record<string, unknown>> | undefined)[][] = data.entities.map(() => []);

  // Validate the final ownership counts and every payload before any part of the checkpoint changes.
  for (let index = 0; index < data.components.length; index++) {
    const component = data.components[index]!;
    if (world.isRelation(component)) {
      world.preflightRelationPairs(
        component,
        data.entities.map(({ entity, components }) => ({ entity, pairs: components[index]!.pairs! })),
      );
      continue;
    }
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
        preparePayload(world, fixups, properties);
      world.validateComponentData(component, payload as Record<string, unknown> | undefined);
      payloads[e]![index] = payload;
    }
    const cap = component.maxOwners;
    if (cap !== null && cap !== undefined && finalOwners > cap) {
      throw new CapacityError(`Component ${component.name} exceeds its maximum owner count.`);
    }
  }

  // Free capped memberships first, so application never depends on entity order.
  for (const { entity, components } of data.entities) {
    for (let index = 0; index < data.components.length; index++) {
      const component = data.components[index]!;
      if (components[index]!.pairs !== undefined) continue;
      if (!components[index]!.present && world.entityHasComponent(entity, component)) {
        world.removeComponentFromEntity(entity, component);
      }
    }
  }
  for (let e = 0; e < data.entities.length; e++) {
    const { entity, components } = data.entities[e]!;
    for (let index = 0; index < data.components.length; index++) {
      const component = data.components[index]!;
      const captured = components[index]!;
      if (captured.pairs !== undefined) {
        world.restoreRelationPairs(entity, component, captured.pairs);
        continue;
      }
      if (!captured.present) continue;
      const payload = payloads[e]![index] as Record<string, unknown> | undefined;
      if (!world.entityHasComponent(entity, component)) {
        world.addComponentToEntity(entity, component, payload);
      } else if (payload !== undefined) {
        world.setComponentEntityData(entity, component, payload);
      }
    }
  }
}

function forEachEntity(entitySet: CheckpointEntitySet, fn: (entity: Entity) => void): void {
  if (Symbol.iterator in Object(entitySet)) {
    for (const entity of entitySet as Iterable<Entity>) fn(entity);
    return;
  }
  (entitySet as { forEach(fn: (entity: Entity) => void): void }).forEach(fn);
}
