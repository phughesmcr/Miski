import type { Entity } from "@/entity/entity.ts";
import { CapacityError, EntityNotFoundError } from "@/errors.ts";
import type { DynamicComponent } from "@/types/component.ts";

/** Entity collection accepted by {@link World.captureCheckpoint}. */
export type CheckpointEntitySet =
  | Iterable<Entity>
  | { forEach(fn: (entity: Entity) => void): void };

type CapturedComponent =
  | { readonly present: false }
  | { readonly present: true; readonly properties?: Readonly<Record<string, number>> };

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
    get(entity: Entity, key: string): number;
    type: { schema: Record<string, unknown> | null };
  };
  getOwnerCount(component: DynamicComponent): number;
  validateComponentData(component: DynamicComponent, properties: Record<string, number> | undefined): void;
  setComponentEntityData(entity: Entity, component: DynamicComponent, properties: Record<string, number>): void;
  addComponentToEntity(
    entity: Entity,
    component: DynamicComponent,
    properties?: Record<string, number>,
  ): void;
  removeComponentFromEntity(entity: Entity, component: DynamicComponent): void;
}

const checkpointData = new WeakMap<ComponentCheckpoint, CheckpointData>();

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
      const properties: Record<string, number> = {};
      for (const key of keys[index]!) properties[key] = storage.get(entity, key);
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

  // Validate the final ownership counts before any part of the checkpoint changes.
  for (let index = 0; index < data.components.length; index++) {
    const component = data.components[index]!;
    let finalOwners = world.getOwnerCount(component);
    for (const { entity, components } of data.entities) {
      const captured = components[index]!;
      const present = world.entityHasComponent(entity, component);
      finalOwners += Number(captured.present) - Number(present);
      if (captured.present) world.validateComponentData(component, captured.properties);
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
  for (const { entity, components } of data.entities) {
    for (let index = 0; index < data.components.length; index++) {
      const component = data.components[index]!;
      const captured = components[index]!;
      if (!captured.present) continue;
      if (!world.entityHasComponent(entity, component)) {
        world.addComponentToEntity(entity, component, captured.properties);
      } else if (captured.properties !== undefined) {
        world.setComponentEntityData(entity, component, captured.properties);
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
