/// <reference lib="deno.ns" />

import { Component, Query, World } from "../mod.ts";
import type { ComponentInstance, Entity } from "../mod.ts";
import {
  countEntities,
  createBenchmarkComponents,
  createMovementQuery,
  createProjectileQuery,
  createRenderableQuery,
  createWideQuery,
  LARGE_CAPACITY,
  MEDIUM_CAPACITY,
  mustCreateEntity,
  populateMixedWorld,
  populateMovementWorld,
  populateSparseLifecycleWorld,
  populateWideWorld,
  SMALL_CAPACITY,
  type Vec2,
} from "./fixtures.ts";

let entitySink = 0;
let numericSink = 0;
let objectSink: unknown;

const componentSet = createBenchmarkComponents();
const mixed = await populateMixedWorld(MEDIUM_CAPACITY, componentSet);
const movementSmall = await populateMovementWorld(SMALL_CAPACITY);
const movementMedium = await populateMovementWorld(MEDIUM_CAPACITY);
const movementLarge = await populateMovementWorld(LARGE_CAPACITY);
const lifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const batchTransitions = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const queryInvalidation = await populateMovementWorld(SMALL_CAPACITY);
const transitionTracking = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const wide = await populateWideWorld(SMALL_CAPACITY);

const movementQuery = createMovementQuery(mixed.components);
const renderableQuery = createRenderableQuery(mixed.components);
const projectileQuery = createProjectileQuery(mixed.components);
const movementFrameRenderableQuery = createRenderableQuery(movementMedium.components);
const invalidationMovementQuery = createMovementQuery(queryInvalidation.components);
const transitionTrackingQuery = createMovementQuery(transitionTracking.components);
const wideQuery = createWideQuery(wide.components);
const batchPositionQuery = new Query({ all: [batchTransitions.components.position] });
mixed.world.entities.query(movementQuery);
mixed.world.entities.query(renderableQuery);
mixed.world.entities.query(projectileQuery);
movementMedium.world.entities.query(movementFrameRenderableQuery);
queryInvalidation.world.entities.query(invalidationMovementQuery);
transitionTracking.world.entities.query(transitionTrackingQuery);
wide.world.entities.query(wideQuery);
batchTransitions.world.entities.query(batchPositionQuery);

const positionInstance = mixed.world.components.getInstance(mixed.components.position) as ComponentInstance<Vec2>;
const positionStorage = positionInstance.storage;
const positionProxy = positionInstance.proxy;
if (positionStorage === null || positionProxy === null) {
  throw new Error("benchmark expected position component storage");
}

const mutationEntity = mixed.entities[128]!;
const addRemoveEntity = mustCreateEntity(lifecycle.world);
const lifecycleEntity = mustCreateEntity(lifecycle.world);
const fullSpawnEntities = new Array<Entity>(128);
let destroyOneComponentEntity = mustCreateEntity(lifecycle.world);
let destroyThreeComponentEntity = mustCreateEntity(lifecycle.world);
let destroySixComponentEntity = mustCreateEntity(lifecycle.world);
const transitionQueryEntity = queryInvalidation.entities[1]!;
const enteredExitedEntity = mustCreateEntity(transitionTracking.world);
const wideTransitionEntity = mustCreateEntity(wide.world);
lifecycle.world.components.addToEntity(lifecycle.components.position, addRemoveEntity, { x: 0, y: 0 });
lifecycle.world.components.addToEntity(lifecycle.components.position, lifecycleEntity, { x: 0, y: 0 });
lifecycle.world.components.addToEntity(lifecycle.components.position, destroyOneComponentEntity, { x: 0, y: 0 });
lifecycle.world.components.addToEntity(lifecycle.components.position, destroyThreeComponentEntity, { x: 0, y: 0 });
lifecycle.world.components.addToEntity(lifecycle.components.velocity, destroyThreeComponentEntity, { x: 1, y: 1 });
lifecycle.world.components.addToEntity(lifecycle.components.renderable, destroyThreeComponentEntity);
lifecycle.world.components.addToEntity(lifecycle.components.position, destroySixComponentEntity, { x: 0, y: 0 });
lifecycle.world.components.addToEntity(lifecycle.components.velocity, destroySixComponentEntity, { x: 1, y: 1 });
lifecycle.world.components.addToEntity(lifecycle.components.health, destroySixComponentEntity, {
  current: 100,
  max: 100,
});
lifecycle.world.components.addToEntity(lifecycle.components.renderState, destroySixComponentEntity, {
  sprite: 1,
  layer: 1,
});
lifecycle.world.components.addToEntity(lifecycle.components.renderable, destroySixComponentEntity);
lifecycle.world.components.addToEntity(lifecycle.components.projectile, destroySixComponentEntity);
lifecycle.world.refresh();
queryInvalidation.world.components.removeFromEntity(queryInvalidation.components.velocity, transitionQueryEntity);
queryInvalidation.world.refresh();
transitionTracking.world.components.addToEntity(transitionTracking.components.position, enteredExitedEntity, {
  x: 0,
  y: 0,
});
transitionTracking.world.refresh();
wide.world.components.addToEntity(wide.components.all[0]!, wideTransitionEntity);
wide.world.components.addToEntity(wide.components.all[31]!, wideTransitionEntity);
wide.world.refresh();

const soaX = new Float32Array(MEDIUM_CAPACITY);
const soaY = new Float32Array(MEDIUM_CAPACITY);
const soaVx = new Float32Array(MEDIUM_CAPACITY);
const soaVy = new Float32Array(MEDIUM_CAPACITY);
const queryMask = new Uint8Array(MEDIUM_CAPACITY);
const aosEntities = new Array<{ x: number; y: number; vx: number; vy: number; renderable: boolean }>(MEDIUM_CAPACITY);
for (let i = 0; i < MEDIUM_CAPACITY; i++) {
  soaX[i] = i;
  soaY[i] = i;
  soaVx[i] = 1;
  soaVy[i] = -1;
  queryMask[i] = (i & 1) === 0 ? 1 : 0;
  aosEntities[i] = { x: i, y: i, vx: 1, vy: -1, renderable: (i & 1) === 0 };
}

function spawnProjectileBatch(out: Entity[]): void {
  for (let i = 0; i < out.length; i++) {
    const entity = mustCreateEntity(lifecycle.world);
    out[i] = entity;
    lifecycle.world.components.addToEntity(lifecycle.components.position, entity, { x: i, y: i });
    lifecycle.world.components.addToEntity(lifecycle.components.velocity, entity, { x: 10, y: -2 });
    lifecycle.world.components.addToEntity(lifecycle.components.lifetime, entity, { ttl: 2 });
    lifecycle.world.components.addToEntity(lifecycle.components.renderState, entity, { sprite: i & 255, layer: 2 });
    lifecycle.world.components.addToEntity(lifecycle.components.renderable, entity);
    lifecycle.world.components.addToEntity(lifecycle.components.projectile, entity);
  }
}

function destroyBatch(entities: Entity[]): void {
  for (let i = 0; i < entities.length; i++) {
    lifecycle.world.entities.destroy(entities[i]!);
  }
}

function addSixComponentEntity(entity: Entity): void {
  lifecycle.world.components.addToEntity(lifecycle.components.position, entity, { x: 0, y: 0 });
  lifecycle.world.components.addToEntity(lifecycle.components.velocity, entity, { x: 1, y: 1 });
  lifecycle.world.components.addToEntity(lifecycle.components.health, entity, { current: 100, max: 100 });
  lifecycle.world.components.addToEntity(lifecycle.components.renderState, entity, { sprite: 1, layer: 1 });
  lifecycle.world.components.addToEntity(lifecycle.components.renderable, entity);
  lifecycle.world.components.addToEntity(lifecycle.components.projectile, entity);
}

Deno.bench({
  name: "Component constructor - tag",
  group: "definition construction",
  baseline: true,
  fn: () => {
    objectSink = new Component<null>({ name: "benchmark_tag" });
  },
});

Deno.bench({
  name: "Component constructor - two Float32 fields",
  group: "definition construction",
  fn: () => {
    objectSink = new Component<Vec2>({
      name: "benchmark_position",
      schema: { x: Float32Array, y: Float32Array },
    });
  },
});

Deno.bench({
  name: "Query constructor - all/any/none gameplay filter",
  group: "definition construction",
  fn: () => {
    objectSink = new Query({
      all: [mixed.components.position, mixed.components.velocity],
      any: [mixed.components.renderable, mixed.components.projectile],
      none: [mixed.components.sleeping],
    });
  },
});

Deno.bench({
  name: "World constructor + init - 1K capacity / 12 components",
  group: "world setup",
  baseline: true,
  fn: async () => {
    const world = new World({ capacity: SMALL_CAPACITY, components: createBenchmarkComponents().all });
    await world.init();
    objectSink = world;
  },
});

Deno.bench({
  name: "World constructor + init - 8K capacity / 12 components",
  group: "world setup",
  fn: async () => {
    const world = new World({ capacity: MEDIUM_CAPACITY, components: createBenchmarkComponents().all });
    await world.init();
    objectSink = world;
  },
});

Deno.bench({
  name: "World constructor + init - 32K capacity / 12 components",
  group: "world setup",
  fn: async () => {
    const world = new World({ capacity: LARGE_CAPACITY, components: createBenchmarkComponents().all });
    await world.init();
    objectSink = world;
  },
});

Deno.bench({
  name: "create + destroy recycled entity",
  group: "entity lifecycle",
  baseline: true,
  fn: () => {
    const entity = mustCreateEntity(lifecycle.world);
    lifecycle.world.entities.destroy(entity);
    entitySink ^= entity;
  },
});

Deno.bench({
  name: "create 256 entities then destroy 256",
  group: "entity lifecycle",
  fn: () => {
    const created = new Array<Entity>(256);
    for (let i = 0; i < created.length; i++) {
      created[i] = mustCreateEntity(lifecycle.world);
    }
    for (let i = 0; i < created.length; i++) {
      lifecycle.world.entities.destroy(created[i]!);
    }
    entitySink ^= created[0]!;
  },
});

Deno.bench({
  name: "spawn/despawn 128 projectiles with 6 components",
  group: "entity lifecycle",
  fn: () => {
    spawnProjectileBatch(fullSpawnEntities);
    destroyBatch(fullSpawnEntities);
    entitySink ^= fullSpawnEntities[0]!;
  },
});

Deno.bench({
  name: "iterate active entities - 8K world",
  group: "entity lifecycle",
  fn: () => {
    entitySink ^= countEntities(mixed.world.entities.getActive());
  },
});

Deno.bench({
  name: "destroy entity with 1 component and respawn",
  group: "entity lifecycle",
  fn: () => {
    lifecycle.world.entities.destroy(destroyOneComponentEntity);
    destroyOneComponentEntity = mustCreateEntity(lifecycle.world);
    lifecycle.world.components.addToEntity(lifecycle.components.position, destroyOneComponentEntity, { x: 0, y: 0 });
    entitySink ^= destroyOneComponentEntity;
  },
});

Deno.bench({
  name: "destroy entity with 3 components and respawn",
  group: "entity lifecycle",
  fn: () => {
    lifecycle.world.entities.destroy(destroyThreeComponentEntity);
    destroyThreeComponentEntity = mustCreateEntity(lifecycle.world);
    lifecycle.world.components.addToEntity(lifecycle.components.position, destroyThreeComponentEntity, { x: 0, y: 0 });
    lifecycle.world.components.addToEntity(lifecycle.components.velocity, destroyThreeComponentEntity, { x: 1, y: 1 });
    lifecycle.world.components.addToEntity(lifecycle.components.renderable, destroyThreeComponentEntity);
    entitySink ^= destroyThreeComponentEntity;
  },
});

Deno.bench({
  name: "destroy entity with 6 components and respawn",
  group: "entity lifecycle",
  fn: () => {
    lifecycle.world.entities.destroy(destroySixComponentEntity);
    destroySixComponentEntity = mustCreateEntity(lifecycle.world);
    addSixComponentEntity(destroySixComponentEntity);
    entitySink ^= destroySixComponentEntity;
  },
});

Deno.bench({
  name: "isActive hot check",
  group: "entity lifecycle",
  fn: () => {
    numericSink ^= mixed.world.entities.isActive(mutationEntity) ? 1 : 0;
  },
});

Deno.bench({
  name: "add/remove tag component on recycled entity",
  group: "archetype transitions",
  baseline: true,
  fn: () => {
    lifecycle.world.components.addToEntity(lifecycle.components.renderable, addRemoveEntity);
    lifecycle.world.components.removeFromEntity(lifecycle.components.renderable, addRemoveEntity);
  },
});

Deno.bench({
  name: "add/remove data component on recycled entity",
  group: "archetype transitions",
  fn: () => {
    lifecycle.world.components.addToEntity(lifecycle.components.velocity, addRemoveEntity, { x: 1, y: -1 });
    lifecycle.world.components.removeFromEntity(lifecycle.components.velocity, addRemoveEntity);
  },
});

Deno.bench({
  name: "batch add/remove tag component across queryList",
  group: "archetype transitions",
  fn: () => {
    const positioned = batchTransitions.world.entities.queryList(batchPositionQuery);
    batchTransitions.world.components.addToEntities(batchTransitions.components.renderable, positioned);
    batchTransitions.world.components.removeFromEntities(batchTransitions.components.renderable, positioned);
  },
});

Deno.bench({
  name: "move entity across common gameplay archetypes",
  group: "archetype transitions",
  fn: () => {
    lifecycle.world.components.addToEntity(lifecycle.components.velocity, lifecycleEntity, { x: 1, y: 1 });
    lifecycle.world.components.addToEntity(lifecycle.components.projectile, lifecycleEntity);
    lifecycle.world.components.addToEntity(lifecycle.components.lifetime, lifecycleEntity, { ttl: 1.5 });
    lifecycle.world.components.removeFromEntity(lifecycle.components.lifetime, lifecycleEntity);
    lifecycle.world.components.removeFromEntity(lifecycle.components.projectile, lifecycleEntity);
    lifecycle.world.components.removeFromEntity(lifecycle.components.velocity, lifecycleEntity);
  },
});

Deno.bench({
  name: "direct typed-array component write",
  group: "component data hot path",
  baseline: true,
  fn: () => {
    positionStorage.partitions.x[mutationEntity] = (positionStorage.partitions.x[mutationEntity] ?? 0) + 1;
    positionStorage.partitions.y[mutationEntity] = (positionStorage.partitions.y[mutationEntity] ?? 0) - 1;
  },
});

Deno.bench({
  name: "setEntityData component write with changed tracking",
  group: "component data hot path",
  fn: () => {
    mixed.world.components.setEntityData(mixed.components.position, mutationEntity, {
      x: numericSink++,
      y: -numericSink,
    });
  },
});

Deno.bench({
  name: "proxy component write with changed tracking",
  group: "component data hot path",
  fn: () => {
    positionProxy.entity = mutationEntity;
    positionProxy.x = numericSink++;
    positionProxy.y = -numericSink;
  },
});

Deno.bench({
  name: "getEntityData object materialization",
  group: "component data hot path",
  fn: () => {
    objectSink = mixed.world.components.getEntityData(mixed.components.position, mutationEntity);
  },
});

Deno.bench({
  name: "entityHas component ownership check",
  group: "component data hot path",
  fn: () => {
    numericSink ^= mixed.world.components.entityHas(mixed.components.position, mutationEntity) ? 1 : 0;
  },
});

Deno.bench({
  name: "iterate changed component entities",
  group: "component data hot path",
  fn: () => {
    numericSink ^= countEntities(mixed.world.components.getChanged(mixed.components.position));
  },
});

Deno.bench({
  name: "iterate component owners - position",
  group: "component data hot path",
  fn: () => {
    numericSink ^= countEntities(mixed.world.components.getOwners(mixed.components.position));
  },
});

Deno.bench({
  name: "iterate component owners - renderable tag",
  group: "component data hot path",
  fn: () => {
    numericSink ^= countEntities(mixed.world.components.getOwners(mixed.components.renderable));
  },
});

Deno.bench({
  name: "cached query - movement all + none",
  group: "queries",
  baseline: true,
  fn: () => {
    entitySink ^= countEntities(mixed.world.entities.query(movementQuery));
  },
});

Deno.bench({
  name: "queryList cached - movement all + none",
  group: "queries",
  fn: () => {
    const result = mixed.world.entities.queryList(movementQuery);
    let count = 0;
    for (let i = 0; i < result.count; i++) {
      count++;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "cached query - renderable all + any",
  group: "queries",
  fn: () => {
    entitySink ^= countEntities(mixed.world.entities.query(renderableQuery));
  },
});

Deno.bench({
  name: "cached query - projectile triple-all",
  group: "queries",
  fn: () => {
    entitySink ^= countEntities(mixed.world.entities.query(projectileQuery));
  },
});

Deno.bench({
  name: "archetype queryEntities generator",
  group: "queries",
  fn: () => {
    entitySink ^= countEntities(mixed.world.archetypes.queryEntities(movementQuery));
  },
});

Deno.bench({
  name: "query component record lookup",
  group: "queries",
  fn: () => {
    objectSink = mixed.world.components.query(movementQuery);
  },
});

Deno.bench({
  name: "query cache miss after world refresh",
  group: "queries",
  fn: () => {
    queryInvalidation.world.refresh();
    entitySink ^= countEntities(queryInvalidation.world.entities.query(invalidationMovementQuery));
  },
});

Deno.bench({
  name: "register new query after cached query",
  group: "queries",
  fn: () => {
    entitySink ^= countEntities(queryInvalidation.world.entities.query(invalidationMovementQuery));
    entitySink ^= countEntities(
      queryInvalidation.world.entities.query(
        new Query({ all: [queryInvalidation.components.position], none: [queryInvalidation.components.sleeping] }),
      ),
    );
  },
});

Deno.bench({
  name: "query after component transition invalidation",
  group: "queries",
  fn: () => {
    queryInvalidation.world.components.addToEntity(queryInvalidation.components.velocity, transitionQueryEntity, {
      x: 1,
      y: 1,
    });
    entitySink ^= countEntities(queryInvalidation.world.entities.query(invalidationMovementQuery));
    queryInvalidation.world.components.removeFromEntity(queryInvalidation.components.velocity, transitionQueryEntity);
  },
});

Deno.bench({
  name: "query entered/exited transition tracking",
  group: "queries",
  fn: () => {
    transitionTracking.world.components.addToEntity(transitionTracking.components.velocity, enteredExitedEntity, {
      x: 1,
      y: 1,
    });
    entitySink ^= countEntities(transitionTracking.world.archetypes.queryEntered(transitionTrackingQuery));
    transitionTracking.world.components.removeFromEntity(transitionTracking.components.velocity, enteredExitedEntity);
    entitySink ^= countEntities(transitionTracking.world.archetypes.queryExited(transitionTrackingQuery));
    transitionTracking.world.refresh();
  },
});

Deno.bench({
  name: "64-component world cached query",
  group: "queries",
  fn: () => {
    entitySink ^= countEntities(wide.world.entities.query(wideQuery));
  },
});

Deno.bench({
  name: "64-component world queryList cached query",
  group: "queries",
  fn: () => {
    const result = wide.world.entities.queryList(wideQuery);
    entitySink ^= result.count;
  },
});

Deno.bench({
  name: "64-component world archetype transition",
  group: "queries",
  fn: () => {
    wide.world.components.addToEntity(wide.components.all[63]!, wideTransitionEntity);
    entitySink ^= countEntities(wide.world.entities.query(wideQuery));
    wide.world.components.removeFromEntity(wide.components.all[63]!, wideTransitionEntity);
  },
});

Deno.bench({
  name: "plain SoA typed-array movement baseline - 8K",
  group: "baselines",
  baseline: true,
  fn: () => {
    for (let i = 0; i < MEDIUM_CAPACITY; i++) {
      soaX[i] = (soaX[i] ?? 0) + soaVx[i]!;
      soaY[i] = (soaY[i] ?? 0) + soaVy[i]!;
    }
    numericSink ^= soaX[0]!;
  },
});

Deno.bench({
  name: "plain AoS object movement baseline - 8K",
  group: "baselines",
  fn: () => {
    for (let i = 0; i < aosEntities.length; i++) {
      const entity = aosEntities[i]!;
      entity.x += entity.vx;
      entity.y += entity.vy;
    }
    numericSink ^= aosEntities[0]!.x;
  },
});

Deno.bench({
  name: "plain Uint8Array mask query baseline - 8K",
  group: "baselines",
  fn: () => {
    let count = 0;
    for (let i = 0; i < queryMask.length; i++) {
      count += queryMask[i]!;
    }
    numericSink ^= count;
  },
});

Deno.bench({
  name: "system update movement - 1K world",
  group: "systems and frames",
  baseline: true,
  fn: () => {
    movementSmall.movement(1 / 60);
  },
});

Deno.bench({
  name: "system update movement - 8K world",
  group: "systems and frames",
  fn: () => {
    movementMedium.movement(1 / 60);
  },
});

Deno.bench({
  name: "system update movement - 32K world",
  group: "systems and frames",
  fn: () => {
    movementLarge.movement(1 / 60);
  },
});

Deno.bench({
  name: "game frame - move, query renderables, refresh",
  group: "systems and frames",
  fn: () => {
    movementMedium.movement(1 / 60);
    entitySink ^= countEntities(movementMedium.world.entities.query(movementFrameRenderableQuery));
    movementMedium.world.refresh();
  },
});

if (entitySink === Number.MIN_SAFE_INTEGER || numericSink === Number.MIN_SAFE_INTEGER || objectSink === null) {
  throw new Error("unreachable benchmark sink");
}
