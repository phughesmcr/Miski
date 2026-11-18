/// <reference lib="deno.ns" />

import { Component, Query, Relation, System, World } from "../mod.ts";
import type { ComponentInstance, Entity } from "../mod.ts";

export type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };
export type Health = { current: Uint16ArrayConstructor; max: Uint16ArrayConstructor };
export type RenderState = { sprite: Uint16ArrayConstructor; layer: Uint8ArrayConstructor };
export type Lifetime = { ttl: Float32ArrayConstructor };
export type Parent = { parentEntity: Uint32ArrayConstructor };

export type BenchmarkComponents = ReturnType<typeof createBenchmarkComponents>;
export type WideComponents = ReturnType<typeof createWideComponents>;

export type MovementSystem = (dt: number) => void;

export const SMALL_CAPACITY = 1_024;
export const MEDIUM_CAPACITY = 8_192;
export const LARGE_CAPACITY = 32_768;

export function createBenchmarkComponents() {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const acceleration = new Component<Vec2>({ name: "acceleration", schema: { x: Float32Array, y: Float32Array } });
  const health = new Component<Health>({
    name: "health",
    schema: { current: Uint16Array, max: Uint16Array },
  });
  const renderState = new Component<RenderState>({
    name: "render_state",
    schema: { sprite: Uint16Array, layer: Uint8Array },
  });
  const lifetime = new Component<Lifetime>({ name: "lifetime", schema: { ttl: Float32Array } });
  const parent = new Component<Parent>({ name: "parent", schema: { parentEntity: Uint32Array } });
  const renderable = new Component<null>({ name: "renderable" });
  const player = new Component<null>({ name: "player", maxEntities: 1 });
  const enemy = new Component<null>({ name: "enemy" });
  const projectile = new Component<null>({ name: "projectile" });
  const sleeping = new Component<null>({ name: "sleeping" });

  return {
    position,
    velocity,
    acceleration,
    health,
    renderState,
    lifetime,
    parent,
    renderable,
    player,
    enemy,
    projectile,
    sleeping,
    all: [
      position,
      velocity,
      acceleration,
      health,
      renderState,
      lifetime,
      parent,
      renderable,
      player,
      enemy,
      projectile,
      sleeping,
    ],
  };
}

export function createWideComponents(count: number = 64) {
  const components = new Array<Component<null>>(count);
  for (let i = 0; i < count; i++) {
    components[i] = new Component<null>({ name: `wide_${i}` });
  }
  return { all: components };
}

export async function createWorld(
  capacity: number = MEDIUM_CAPACITY,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<World> {
  const world = new World({ capacity, components: components.all });
  await world.init();
  return world;
}

export function mustCreateEntity(world: World): Entity {
  const entity = world.entities.create();
  if (entity === undefined) {
    throw new Error("benchmark fixture exhausted entity capacity");
  }
  return entity;
}

export function createMovementQuery(components: BenchmarkComponents): Query {
  return new Query({ all: [components.position, components.velocity], none: [components.sleeping] });
}

export function createRenderableQuery(components: BenchmarkComponents): Query {
  return new Query({ all: [components.position, components.renderState], any: [components.renderable] });
}

export function createProjectileQuery(components: BenchmarkComponents): Query {
  return new Query({ all: [components.position, components.velocity, components.projectile] });
}

export function createWideQuery(components: WideComponents): Query {
  return new Query({
    all: [components.all[0]!, components.all[31]!, components.all[63]!],
    none: [components.all[7]!, components.all[47]!],
  });
}

export function countEntities(iterable: Iterable<Entity> | undefined): number {
  let count = 0;
  if (iterable === undefined) return count;
  for (const _entity of iterable) {
    count++;
  }
  return count;
}

export async function populateMixedWorld(
  capacity: number = MEDIUM_CAPACITY,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<{ world: World; components: BenchmarkComponents; entities: Entity[] }> {
  const world = await createWorld(capacity, components);
  const entities = new Array<Entity>(capacity);

  for (let i = 0; i < capacity; i++) {
    const entity = mustCreateEntity(world);
    entities[i] = entity;
    world.components.addToEntity(components.position, entity, { x: i, y: i * 0.5 });

    if ((i & 1) === 0) {
      world.components.addToEntity(components.velocity, entity, { x: 1, y: -1 });
    }
    if (i % 3 === 0) {
      world.components.addToEntity(components.health, entity, { current: 100, max: 100 });
    }
    if (i % 4 === 0) {
      world.components.addToEntity(components.renderState, entity, { sprite: i & 255, layer: i & 7 });
      world.components.addToEntity(components.renderable, entity);
    }
    if (i % 8 === 0) {
      world.components.addToEntity(components.enemy, entity);
    }
    if (i % 16 === 0) {
      world.components.addToEntity(components.projectile, entity);
      world.components.addToEntity(components.lifetime, entity, { ttl: 3 });
    }
    if (i % 64 === 0) {
      world.components.addToEntity(components.sleeping, entity);
    }
  }

  world.refresh();
  return { world, components, entities };
}

export async function populateMovementWorld(
  capacity: number,
  components: BenchmarkComponents = createBenchmarkComponents(),
  argCount?: 1,
): Promise<{ world: World; components: BenchmarkComponents; entities: Entity[]; movement: MovementSystem }> {
  const world = await createWorld(capacity, components);
  const entities = new Array<Entity>(capacity);

  for (let i = 0; i < capacity; i++) {
    const entity = mustCreateEntity(world);
    entities[i] = entity;
    world.components.addToEntity(components.position, entity, { x: i, y: i });
    world.components.addToEntity(components.velocity, entity, { x: 1, y: -1 });
    if (i % 32 === 0) {
      world.components.addToEntity(components.sleeping, entity);
    }
  }

  const movementSystem = new System({
    name: "movement",
    query: createMovementQuery(components),
    argCount,
    callback: (componentRecord, entities, dt: number): void => {
      const position = componentRecord["position"] as ComponentInstance<Vec2>;
      const velocity = componentRecord["velocity"] as ComponentInstance<Vec2>;
      const positionStorage = position.storage;
      const velocityStorage = velocity.storage;
      if (positionStorage === null || velocityStorage === null) {
        throw new Error("movement fixture expected storage components");
      }
      const px = positionStorage.partitions.x;
      const py = positionStorage.partitions.y;
      const vx = velocityStorage.partitions.x;
      const vy = velocityStorage.partitions.y;
      for (let i = 0; i < entities.count; i++) {
        const slot = entities.slots[i]!;
        px[slot] = (px[slot] ?? 0) + (vx[slot] ?? 0) * dt;
        py[slot] = (py[slot] ?? 0) + (vy[slot] ?? 0) * dt;
      }
    },
  });

  const movement = world.systems.create(movementSystem) as MovementSystem;
  world.refresh();
  return { world, components, entities, movement };
}

export async function populateSparseLifecycleWorld(
  capacity: number,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<{ world: World; components: BenchmarkComponents; recycled: Entity[] }> {
  const world = await createWorld(capacity, components);
  const recycled: Entity[] = [];

  for (let i = 0; i < capacity; i++) {
    const entity = mustCreateEntity(world);
    world.components.addToEntity(components.position, entity, { x: i, y: i });
    if ((i & 1) === 0) {
      world.components.addToEntity(components.velocity, entity, { x: 1, y: 1 });
    }
    if (i % 8 === 0) {
      recycled.push(entity);
    }
  }

  for (const entity of recycled) {
    world.entities.destroy(entity);
  }

  world.refresh();
  return { world, components, recycled };
}

export async function populateWideWorld(
  capacity: number = SMALL_CAPACITY,
  components: WideComponents = createWideComponents(),
): Promise<{ world: World; components: WideComponents; entities: Entity[] }> {
  const world = new World({ capacity, components: components.all });
  await world.init();
  const activeCount = Math.max(0, capacity - 16);
  const entities = new Array<Entity>(activeCount);

  for (let i = 0; i < activeCount; i++) {
    const entity = mustCreateEntity(world);
    entities[i] = entity;
    world.components.addToEntity(components.all[0]!, entity);
    if ((i & 1) === 0) world.components.addToEntity(components.all[31]!, entity);
    if (i % 4 === 0) world.components.addToEntity(components.all[63]!, entity);
    if (i % 16 === 0) world.components.addToEntity(components.all[47]!, entity);
  }

  world.refresh();
  return { world, components, entities };
}

export type Link = { weight: Float32ArrayConstructor };

/**
 * A world with a 4-ary `childOf` hierarchy over `nodes` entities (cascade, acyclic), a multi-target `likes`
 * relation (each node likes the next two nodes) and an exclusive data relation `aims`.
 */
export async function populateRelationWorld(capacity: number, nodes: number = 1_024) {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const childOf = new Relation({ name: "childOf", exclusive: true, acyclic: true, onDeleteTarget: "cascade" });
  const likes = new Relation({ name: "likes" });
  const aims = new Relation({ name: "aims", exclusive: true, schema: { weight: Float32Array } });
  const world = new World({ capacity, components: [position, childOf, likes, aims] });
  await world.init();
  const entities: Entity[] = [];
  for (let i = 0; i < nodes; i++) {
    const entity = mustCreateEntity(world);
    world.components.addToEntity(position, entity, { x: i, y: i });
    entities.push(entity);
    if (i > 0) world.relations.add(childOf, entity, entities[(i - 1) >> 2]!);
  }
  for (let i = 0; i < nodes; i++) {
    world.relations.add(likes, entities[i]!, entities[(i + 1) % nodes]!);
    world.relations.add(likes, entities[i]!, entities[(i + 2) % nodes]!);
    world.relations.add(aims, entities[i]!, entities[(i + 7) % nodes]!, { weight: i });
  }
  world.refresh();
  return { world, position, childOf, likes, aims, entities };
}
