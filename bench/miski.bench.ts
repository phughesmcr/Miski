/// <reference lib="deno.ns" />

import {
  captureWorldRollbackPoint,
  Component,
  entityIndex,
  field,
  loadWorld,
  measureWorldSave,
  Prefab,
  Query,
  restoreWorldRollbackPoint,
  saveWorld,
  saveWorldInto,
  World,
  worldSaveFromJSON,
  worldSaveToJSON,
} from "../mod.ts";
import type { ComponentInstance, Entity } from "../mod.ts";
import {
  countEntities,
  createBenchmarkComponents,
  createMovementQuery,
  createProjectileQuery,
  createRenderableQuery,
  createWideQuery,
  type Health,
  LARGE_CAPACITY,
  MEDIUM_CAPACITY,
  mustCreateEntity,
  populateMixedWorld,
  populateMovementWorld,
  populateNamedWorld,
  populateRelationWorld,
  populateSparseLifecycleWorld,
  populateWideWorld,
  type RenderState,
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
const repeatedSpawnLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const bundledSpawnLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const batchTransitions = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const batchDataTransitions = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const queryInvalidation = await populateMovementWorld(SMALL_CAPACITY);
const transitionTracking = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const wide = await populateWideWorld(SMALL_CAPACITY);

const movementQuery = createMovementQuery(mixed.components);
const renderableQuery = createRenderableQuery(mixed.components);
const renderIncludeQuery = new Query({
  all: [mixed.components.position],
  include: [mixed.components.health, mixed.components.renderState],
});
const projectileQuery = createProjectileQuery(mixed.components);
const movementFrameRenderableQuery = createRenderableQuery(movementMedium.components);
const invalidationMovementQuery = createMovementQuery(queryInvalidation.components);
const transitionTrackingQuery = createMovementQuery(transitionTracking.components);
const wideQuery = createWideQuery(wide.components);
const batchPositionQuery = new Query({ all: [batchTransitions.components.position] });
const batchDataPositionQuery = new Query({ all: [batchDataTransitions.components.position] });
mixed.world.entities.query(movementQuery);
mixed.world.entities.query(renderableQuery);
mixed.world.entities.query(renderIncludeQuery);
mixed.world.components.query(renderIncludeQuery);
mixed.world.entities.query(projectileQuery);
movementMedium.world.entities.query(movementFrameRenderableQuery);
queryInvalidation.world.entities.query(invalidationMovementQuery);
transitionTracking.world.entities.query(transitionTrackingQuery);
wide.world.entities.query(wideQuery);
batchTransitions.world.entities.query(batchPositionQuery);
batchDataTransitions.world.entities.query(batchDataPositionQuery);

const positionInstance = mixed.world.components.getInstance(mixed.components.position) as ComponentInstance<Vec2>;
const positionStorage = positionInstance.storage;
const positionProxy = positionInstance.proxy;
if (positionStorage === null || positionProxy === null) {
  throw new Error("benchmark expected position component storage");
}
const healthInstance = mixed.world.components.getInstance(mixed.components.health) as ComponentInstance<Health>;
const healthPartitions = healthInstance.partitions;
const renderStateInstance = mixed.world.components.getInstance(mixed.components.renderState) as ComponentInstance<
  RenderState
>;
const renderStatePartitions = renderStateInstance.partitions;
const readDataOut = { x: 0, y: 0 };

const mutationEntity = mixed.entities[128]!;
const mutationSlot = entityIndex(mutationEntity);
const healthOwnerEntity = mixed.entities[129]!;
const addRemoveEntity = mustCreateEntity(lifecycle.world);
const lifecycleEntity = mustCreateEntity(lifecycle.world);
const repeatedSpawnEntities = new Array<Entity>(128);
const bundledSpawnEntities = new Array<Entity>(128);
let destroyOneComponentEntity = mustCreateEntity(lifecycle.world);
let destroyThreeComponentEntity = mustCreateEntity(lifecycle.world);
let destroySixComponentEntity = mustCreateEntity(lifecycle.world);
let destroySixBundleEntity = mustCreateEntity(lifecycle.world);
const transitionQueryEntity = queryInvalidation.entities[1]!;
const enteredExitedEntity = mustCreateEntity(transitionTracking.world);
const wideTransitionEntity = mustCreateEntity(wide.world);
const batchData = { x: 1, y: -1 };
const repeatedProjectilePositionData = { x: 0, y: 0 };
const repeatedProjectileVelocityData = { x: 10, y: -2 };
const repeatedProjectileLifetimeData = { ttl: 2 };
const repeatedProjectileRenderData = { sprite: 0, layer: 2 };
const bundledProjectilePositionData = { x: 0, y: 0 };
const bundledProjectileVelocityData = { x: 10, y: -2 };
const bundledProjectileLifetimeData = { ttl: 2 };
const bundledProjectileRenderData = { sprite: 0, layer: 2 };
const bundledProjectileBundle = [
  [bundledSpawnLifecycle.components.position, bundledProjectilePositionData],
  [bundledSpawnLifecycle.components.velocity, bundledProjectileVelocityData],
  [bundledSpawnLifecycle.components.lifetime, bundledProjectileLifetimeData],
  [bundledSpawnLifecycle.components.renderState, bundledProjectileRenderData],
  [bundledSpawnLifecycle.components.renderable],
  [bundledSpawnLifecycle.components.projectile],
] as const;

// Prefab spawn fixtures: the same projectile as `bundledProjectileBundle`, defined once as a template. The two
// prefab worlds share one component set so the single prefab is registered in both.
const prefabComponents = createBenchmarkComponents();
const prefabSpawnLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY, prefabComponents);
const prefabBulkLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY, prefabComponents);
const prefabSpawnEntities = new Array<Entity>(128);
const projectilePrefab = new Prefab({
  name: "projectile",
  components: [
    [prefabComponents.position, { x: 0, y: 0 }],
    [prefabComponents.velocity, { x: 10, y: -2 }],
    [prefabComponents.lifetime, { ttl: 2 }],
    [prefabComponents.renderState, { sprite: 0, layer: 2 }],
    [prefabComponents.renderable],
    [prefabComponents.projectile],
  ],
});
const prefabPositionOverride = { x: 0, y: 0 };
const prefabRenderOverride = { sprite: 0 };
const prefabOverrides = [
  [prefabComponents.position, prefabPositionOverride],
  [prefabComponents.renderState, prefabRenderOverride],
] as const;

function spawnProjectileBatchWithPrefab(out: Entity[]): void {
  const entities = prefabSpawnLifecycle.world.entities;
  for (let i = 0; i < out.length; i++) {
    prefabPositionOverride.x = i;
    prefabPositionOverride.y = i;
    prefabRenderOverride.sprite = i & 255;
    out[i] = entities.instantiateOrThrow(projectilePrefab, prefabOverrides);
  }
}

function destroyPrefabBatch(entities: Entity[]): void {
  for (let i = 0; i < entities.length; i++) {
    prefabSpawnLifecycle.world.entities.destroy(entities[i]!);
  }
}

function spawnProjectileBatchWithInstantiateMany(): void {
  const world = prefabBulkLifecycle.world;
  const list = world.entities.instantiateManyOrThrow(projectilePrefab, 128);
  const { x, y } = world.components.require(prefabComponents.position).storage.partitions;
  const sprite = world.components.require(prefabComponents.renderState).storage.partitions.sprite;
  for (let i = 0; i < list.count; i++) {
    const slot = list.slots[i]!;
    x[slot] = i;
    y[slot] = i;
    sprite[slot] = i & 255;
  }
  for (let i = 0; i < list.count; i++) prefabSpawnEntities[i] = list.entities[i]!;
  for (let i = 0; i < prefabSpawnEntities.length; i++) world.entities.destroy(prefabSpawnEntities[i]!);
  entitySink ^= prefabSpawnEntities[0]!;
  world.refresh();
}
const sixBundlePositionData = { x: 0, y: 0 };
const sixBundleVelocityData = { x: 1, y: 1 };
const sixBundleHealthData = { current: 100, max: 100 };
const sixBundleRenderData = { sprite: 1, layer: 1 };
const sixComponentBundle = [
  [lifecycle.components.position, sixBundlePositionData],
  [lifecycle.components.velocity, sixBundleVelocityData],
  [lifecycle.components.health, sixBundleHealthData],
  [lifecycle.components.renderState, sixBundleRenderData],
  [lifecycle.components.renderable],
  [lifecycle.components.projectile],
] as const;
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
lifecycle.world.components.addBundle(destroySixBundleEntity, sixComponentBundle);
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

function setRepeatedProjectileData(i: number): void {
  repeatedProjectilePositionData.x = i;
  repeatedProjectilePositionData.y = i;
  repeatedProjectileRenderData.sprite = i & 255;
}

function setBundledProjectileData(i: number): void {
  bundledProjectilePositionData.x = i;
  bundledProjectilePositionData.y = i;
  bundledProjectileRenderData.sprite = i & 255;
}

function spawnProjectileBatchRepeated(out: Entity[]): void {
  for (let i = 0; i < out.length; i++) {
    const entity = mustCreateEntity(repeatedSpawnLifecycle.world);
    out[i] = entity;
    setRepeatedProjectileData(i);
    repeatedSpawnLifecycle.world.components.addToEntity(
      repeatedSpawnLifecycle.components.position,
      entity,
      repeatedProjectilePositionData,
    );
    repeatedSpawnLifecycle.world.components.addToEntity(
      repeatedSpawnLifecycle.components.velocity,
      entity,
      repeatedProjectileVelocityData,
    );
    repeatedSpawnLifecycle.world.components.addToEntity(
      repeatedSpawnLifecycle.components.lifetime,
      entity,
      repeatedProjectileLifetimeData,
    );
    repeatedSpawnLifecycle.world.components.addToEntity(
      repeatedSpawnLifecycle.components.renderState,
      entity,
      repeatedProjectileRenderData,
    );
    repeatedSpawnLifecycle.world.components.addToEntity(repeatedSpawnLifecycle.components.renderable, entity);
    repeatedSpawnLifecycle.world.components.addToEntity(repeatedSpawnLifecycle.components.projectile, entity);
  }
}

function spawnProjectileBatchWithCreateWith(out: Entity[]): void {
  for (let i = 0; i < out.length; i++) {
    setBundledProjectileData(i);
    out[i] = bundledSpawnLifecycle.world.entities.createWithOrThrow(bundledProjectileBundle);
  }
}

function destroyRepeatedBatch(entities: Entity[]): void {
  for (let i = 0; i < entities.length; i++) {
    repeatedSpawnLifecycle.world.entities.destroy(entities[i]!);
  }
}

function destroyBundledBatch(entities: Entity[]): void {
  for (let i = 0; i < entities.length; i++) {
    bundledSpawnLifecycle.world.entities.destroy(entities[i]!);
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

function addSixComponentBundle(entity: Entity): void {
  lifecycle.world.components.addBundle(entity, sixComponentBundle);
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
  name: "Query constructor - all + include render components",
  group: "definition construction",
  fn: () => {
    objectSink = new Query({
      all: [mixed.components.position],
      include: [mixed.components.health, mixed.components.renderState],
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
  name: "create + destroy recycled entity + refresh",
  group: "entity lifecycle",
  baseline: true,
  fn: () => {
    const entity = mustCreateEntity(lifecycle.world);
    lifecycle.world.entities.destroy(entity);
    entitySink ^= entity;
    lifecycle.world.refresh();
  },
});

Deno.bench({
  name: "create 256 entities then destroy 256 + refresh",
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
    lifecycle.world.refresh();
  },
});

Deno.bench({
  name: "spawn/despawn 128 projectiles - repeated addToEntity + refresh",
  group: "entity lifecycle",
  baseline: true,
  fn: () => {
    spawnProjectileBatchRepeated(repeatedSpawnEntities);
    destroyRepeatedBatch(repeatedSpawnEntities);
    entitySink ^= repeatedSpawnEntities[0]!;
    repeatedSpawnLifecycle.world.refresh();
  },
});

Deno.bench({
  name: "spawn/despawn 128 projectiles - createWith bundle + refresh",
  group: "entity lifecycle",
  fn: () => {
    spawnProjectileBatchWithCreateWith(bundledSpawnEntities);
    destroyBundledBatch(bundledSpawnEntities);
    entitySink ^= bundledSpawnEntities[0]!;
    bundledSpawnLifecycle.world.refresh();
  },
});

Deno.bench({
  name: "spawn/despawn 128 projectiles - prefab instantiate + overrides + refresh",
  group: "entity lifecycle",
  fn: () => {
    spawnProjectileBatchWithPrefab(prefabSpawnEntities);
    destroyPrefabBatch(prefabSpawnEntities);
    entitySink ^= prefabSpawnEntities[0]!;
    prefabSpawnLifecycle.world.refresh();
  },
});

Deno.bench({
  name: "spawn/despawn 128 projectiles - prefab instantiateMany + slot writes + refresh",
  group: "entity lifecycle",
  fn: spawnProjectileBatchWithInstantiateMany,
});

Deno.bench({
  name: "iterate active entities - 8K world",
  group: "entity lifecycle",
  fn: () => {
    entitySink ^= countEntities(mixed.world.entities.getActive());
  },
});

Deno.bench({
  name: "destroy entity with 1 component and respawn + refresh",
  group: "entity lifecycle",
  fn: () => {
    lifecycle.world.entities.destroy(destroyOneComponentEntity);
    destroyOneComponentEntity = mustCreateEntity(lifecycle.world);
    lifecycle.world.components.addToEntity(lifecycle.components.position, destroyOneComponentEntity, { x: 0, y: 0 });
    entitySink ^= destroyOneComponentEntity;
    lifecycle.world.refresh();
  },
});

Deno.bench({
  name: "destroy entity with 3 components and respawn + refresh",
  group: "entity lifecycle",
  fn: () => {
    lifecycle.world.entities.destroy(destroyThreeComponentEntity);
    destroyThreeComponentEntity = mustCreateEntity(lifecycle.world);
    lifecycle.world.components.addToEntity(lifecycle.components.position, destroyThreeComponentEntity, { x: 0, y: 0 });
    lifecycle.world.components.addToEntity(lifecycle.components.velocity, destroyThreeComponentEntity, { x: 1, y: 1 });
    lifecycle.world.components.addToEntity(lifecycle.components.renderable, destroyThreeComponentEntity);
    entitySink ^= destroyThreeComponentEntity;
    lifecycle.world.refresh();
  },
});

Deno.bench({
  name: "destroy entity with 6 components and respawn + refresh",
  group: "entity lifecycle",
  baseline: true,
  fn: () => {
    lifecycle.world.entities.destroy(destroySixComponentEntity);
    destroySixComponentEntity = mustCreateEntity(lifecycle.world);
    addSixComponentEntity(destroySixComponentEntity);
    entitySink ^= destroySixComponentEntity;
    lifecycle.world.refresh();
  },
});

Deno.bench({
  name: "destroy entity with 6 components and respawn via addBundle + refresh",
  group: "entity lifecycle",
  fn: () => {
    lifecycle.world.entities.destroy(destroySixBundleEntity);
    destroySixBundleEntity = mustCreateEntity(lifecycle.world);
    addSixComponentBundle(destroySixBundleEntity);
    entitySink ^= destroySixBundleEntity;
    lifecycle.world.refresh();
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
  name: "bulk add/remove tag component across queryList - 7,168 entities",
  group: "bulk archetype transitions",
  fn: () => {
    // MEDIUM_CAPACITY sparse lifecycle fixtures leave 7,168 active positioned entities.
    const positioned = batchTransitions.world.entities.queryList(batchPositionQuery);
    batchTransitions.world.components.addToEntities(batchTransitions.components.renderable, positioned);
    const positionedAfterAdd = batchTransitions.world.entities.queryList(batchPositionQuery);
    batchTransitions.world.components.removeFromEntities(batchTransitions.components.renderable, positionedAfterAdd);
  },
});

Deno.bench({
  name: "bulk add/remove data component across queryList - 7,168 entities",
  group: "bulk archetype transitions",
  fn: () => {
    // MEDIUM_CAPACITY sparse lifecycle fixtures leave 7,168 active positioned entities.
    const positioned = batchDataTransitions.world.entities.queryList(batchDataPositionQuery);
    batchDataTransitions.world.components.addToEntities(
      batchDataTransitions.components.acceleration,
      positioned,
      batchData,
    );
    const positionedAfterAdd = batchDataTransitions.world.entities.queryList(batchDataPositionQuery);
    batchDataTransitions.world.components.removeFromEntities(
      batchDataTransitions.components.acceleration,
      positionedAfterAdd,
    );
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
    positionStorage.partitions.x[mutationSlot] = (positionStorage.partitions.x[mutationSlot] ?? 0) + 1;
    positionStorage.partitions.y[mutationSlot] = (positionStorage.partitions.y[mutationSlot] ?? 0) - 1;
  },
});

Deno.bench({
  name: "direct typed-array write + instance.markChanged",
  group: "component data hot path",
  fn: () => {
    positionStorage.partitions.x[mutationSlot] = (positionStorage.partitions.x[mutationSlot] ?? 0) + 1;
    positionStorage.partitions.y[mutationSlot] = (positionStorage.partitions.y[mutationSlot] ?? 0) - 1;
    numericSink ^= positionInstance.markChanged(mutationEntity) ? 1 : 0;
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
  name: "readEntityDataInto reused object",
  group: "component data hot path",
  fn: () => {
    numericSink ^= mixed.world.components.readEntityDataInto(mixed.components.position, mutationEntity, readDataOut) ?
      1 :
      0;
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
  name: "instance.has component ownership check",
  group: "component data hot path",
  fn: () => {
    numericSink ^= healthInstance.has(healthOwnerEntity) ? 1 : 0;
  },
});

Deno.bench({
  name: "iterate dense changed component entities",
  group: "component data hot path",
  fn: () => {
    numericSink ^= countEntities(mixed.world.components.getChanged(mixed.components.position));
  },
});

Deno.bench({
  name: "render loop direct partitions + include ownership checks",
  group: "component data hot path",
  fn: () => {
    const result = mixed.world.entities.queryList(renderIncludeQuery);
    const px = positionStorage.partitions.x;
    const current = healthPartitions.current;
    const sprite = renderStatePartitions.sprite;
    let total = 0;
    for (let i = 0; i < result.count; i++) {
      const entity = result.entities[i]!;
      const slot = result.slots[i]!;
      total += px[slot] ?? 0;
      if (healthInstance.has(entity)) total += current[slot] ?? 0;
      if (renderStateInstance.has(entity)) total += sprite[slot] ?? 0;
    }
    numericSink ^= total;
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
  name: "queryList cached - all + include",
  group: "queries",
  fn: () => {
    const result = mixed.world.entities.queryList(renderIncludeQuery);
    let count = 0;
    for (let i = 0; i < result.count; i++) {
      count++;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "querySnapshot allocating - movement all + none",
  group: "queries",
  fn: () => {
    objectSink = mixed.world.entities.querySnapshot(movementQuery);
  },
});

Deno.bench({
  name: "toArray allocating from queryList - movement all + none",
  group: "queries",
  fn: () => {
    objectSink = mixed.world.entities.toArray(mixed.world.entities.queryList(movementQuery));
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
  name: "query component record lookup",
  group: "queries",
  fn: () => {
    objectSink = mixed.world.components.query(movementQuery);
  },
});

Deno.bench({
  name: "query component record lookup - include",
  group: "queries",
  fn: () => {
    objectSink = mixed.world.components.query(renderIncludeQuery);
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
  name: "world refresh with cached queries",
  group: "queries",
  fn: () => {
    queryInvalidation.world.refresh();
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
    entitySink ^= countEntities(transitionTracking.world.entities.queryEntered(transitionTrackingQuery));
    transitionTracking.world.components.removeFromEntity(transitionTracking.components.velocity, enteredExitedEntity);
    entitySink ^= countEntities(transitionTracking.world.entities.queryExited(transitionTrackingQuery));
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
  name: "getActiveSnapshot allocating - 8K world",
  group: "snapshots",
  baseline: true,
  fn: () => {
    objectSink = mixed.world.entities.getActiveSnapshot();
  },
});

Deno.bench({
  name: "getOwnersSnapshot allocating - position",
  group: "snapshots",
  fn: () => {
    objectSink = mixed.world.components.getOwnersSnapshot(mixed.components.position);
  },
});

Deno.bench({
  name: "getChangedSnapshot allocating - position",
  group: "snapshots",
  fn: () => {
    objectSink = mixed.world.components.getChangedSnapshot(mixed.components.position);
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

// ---------------------------------------------------------------------------
// Non-numeric field types
// ---------------------------------------------------------------------------

class BenchMesh {
  id: number;
  constructor(id = 0) {
    this.id = id;
  }
}

const fieldUnit = new Component({
  name: "fieldUnit",
  schema: {
    hp: Uint16Array,
    alive: field.bool(),
    state: field.enum(["idle", "run", "dead"]),
    target: field.entity(),
    label: field.string(),
    mesh: field.object<BenchMesh>(),
  },
});
const fieldWorld = new World({ capacity: MEDIUM_CAPACITY, components: [fieldUnit] });
await fieldWorld.init();
const fieldMeshes = [new BenchMesh(0), new BenchMesh(1)];
const fieldLabels = ["a", "b"];
const fieldStates = ["idle", "run"] as const;
const fieldEntities: Entity[] = [];
for (let i = 0; i < 1024; i++) {
  fieldEntities.push(
    fieldWorld.entities.createWithOrThrow([[fieldUnit, { hp: i, label: "x", mesh: fieldMeshes[0]! }]]),
  );
}
const fieldTarget = fieldEntities[0]!;
const fieldEntity = fieldEntities[1]!;
const fieldTransitionEntity = mustCreateEntity(fieldWorld);
const fieldInstance = fieldWorld.components.require(fieldUnit);
const fieldProxy = fieldInstance.proxy;
const fieldWriteData = {
  hp: 0,
  alive: false,
  state: "idle" as "idle" | "run" | "dead",
  target: fieldTarget as Entity | null,
  label: "a",
  mesh: fieldMeshes[0]! as BenchMesh | null,
};
const fieldReadOut = { ...fieldWriteData };

Deno.bench({
  name: "proxy numeric field write (baseline)",
  group: "field types",
  baseline: true,
  fn: () => {
    fieldProxy.entity = fieldEntity;
    fieldProxy.hp = numericSink++ & 0xff;
  },
});

Deno.bench({
  name: "proxy bool field write",
  group: "field types",
  fn: () => {
    fieldProxy.entity = fieldEntity;
    fieldProxy.alive = (numericSink++ & 1) === 1;
  },
});

Deno.bench({
  name: "proxy enum field write",
  group: "field types",
  fn: () => {
    fieldProxy.entity = fieldEntity;
    fieldProxy.state = fieldStates[numericSink++ & 1]!;
  },
});

Deno.bench({
  name: "proxy entity field write",
  group: "field types",
  fn: () => {
    fieldProxy.entity = fieldEntity;
    fieldProxy.target = (numericSink++ & 1) === 1 ? fieldTarget : null;
  },
});

Deno.bench({
  name: "proxy string field write",
  group: "field types",
  fn: () => {
    fieldProxy.entity = fieldEntity;
    fieldProxy.label = fieldLabels[numericSink++ & 1]!;
  },
});

Deno.bench({
  name: "proxy object field write",
  group: "field types",
  fn: () => {
    fieldProxy.entity = fieldEntity;
    fieldProxy.mesh = fieldMeshes[numericSink++ & 1]!;
  },
});

Deno.bench({
  name: "proxy entity field read (generation-checked)",
  group: "field types",
  fn: () => {
    fieldProxy.entity = fieldEntity;
    entitySink ^= fieldProxy.target ?? 0;
  },
});

Deno.bench({
  name: "setEntityData all field kinds",
  group: "field types",
  fn: () => {
    const i = numericSink++;
    fieldWriteData.hp = i & 0xff;
    fieldWriteData.alive = (i & 1) === 1;
    fieldWriteData.state = fieldStates[i & 1]!;
    fieldWriteData.label = fieldLabels[i & 1]!;
    fieldWriteData.mesh = fieldMeshes[i & 1]!;
    fieldWorld.components.setEntityData(fieldUnit, fieldEntity, fieldWriteData);
  },
});

Deno.bench({
  name: "readEntityDataInto all field kinds",
  group: "field types",
  fn: () => {
    numericSink ^= fieldWorld.components.readEntityDataInto(fieldUnit, fieldEntity, fieldReadOut) ? 1 : 0;
  },
});

Deno.bench({
  name: "getEntityData all field kinds",
  group: "field types",
  fn: () => {
    objectSink = fieldWorld.components.getEntityData(fieldUnit, fieldEntity);
  },
});

Deno.bench({
  name: "add/remove component with all field kinds",
  group: "field types",
  fn: () => {
    fieldWorld.components.addToEntity(fieldUnit, fieldTransitionEntity);
    fieldWorld.components.removeFromEntity(fieldUnit, fieldTransitionEntity);
  },
});

Deno.bench({
  name: "rollback capture + restore - 1024 owners, all field kinds",
  group: "field types",
  fn: () => {
    const point = captureWorldRollbackPoint(fieldWorld);
    restoreWorldRollbackPoint(fieldWorld, point);
  },
});

const relations = await populateRelationWorld(MEDIUM_CAPACITY);
const relationLeafA = relations.entities[1_000]!;
const relationLeafB = relations.entities[1_001]!;
const relationParentA = relations.entities[10]!;
const relationParentB = relations.entities[20]!;
const relationHub = relations.entities[300]!;
const relationQuery = new Query({ all: [relations.position, relations.likes] });
const relationData = { weight: 0 };
let relationToggle = false;

Deno.bench({
  name: "relation add/remove multi-target pair",
  group: "relations",
  baseline: true,
  fn: () => {
    relations.world.relations.add(relations.likes, relationLeafA, relationHub);
    relations.world.relations.remove(relations.likes, relationLeafA, relationHub);
  },
});

Deno.bench({
  name: "exclusive relation retarget",
  group: "relations",
  fn: () => {
    relationToggle = !relationToggle;
    relations.world.relations.add(relations.childOf, relationLeafB, relationToggle ? relationParentA : relationParentB);
  },
});

Deno.bench({
  name: "relation lookups - sources, targets, queryList by target",
  group: "relations",
  fn: () => {
    entitySink ^= relations.world.relations.getSources(relations.childOf, relationParentA).count;
    entitySink ^= relations.world.relations.getTargets(relations.likes, relationLeafA).count;
    entitySink ^= relations.world.relations.queryList(relations.likes, relationHub, relationQuery).count;
  },
});

Deno.bench({
  name: "relation data setData + readDataInto",
  group: "relations",
  fn: () => {
    relationData.weight = (relationData.weight + 1) % 1_000;
    const target = relations.world.relations.getTarget(relations.aims, relationLeafA)!;
    relations.world.relations.setData(relations.aims, relationLeafA, target, relationData);
    relations.world.relations.readDataInto(relations.aims, relationLeafA, target, relationData);
  },
});

Deno.bench({
  name: "hierarchy traverse 1,024 nodes (cached)",
  group: "relations",
  fn: () => {
    entitySink ^= relations.world.relations.traverse(relations.childOf).count;
  },
});

Deno.bench({
  name: "hierarchy reparent + traverse 1,024 nodes",
  group: "relations",
  fn: () => {
    relationToggle = !relationToggle;
    relations.world.relations.add(relations.childOf, relationLeafA, relationToggle ? relationParentA : relationParentB);
    entitySink ^= relations.world.relations.traverse(relations.childOf).count;
  },
});

Deno.bench({
  name: "cascade destroy 5-node subtree + rebuild + refresh",
  group: "relations",
  fn: () => {
    const parent = mustCreateEntity(relations.world);
    relations.world.relations.add(relations.childOf, parent, relationHub);
    for (let i = 0; i < 4; i++) {
      relations.world.relations.add(relations.childOf, mustCreateEntity(relations.world), parent);
    }
    relations.world.entities.destroy(parent);
    relations.world.refresh();
  },
});

// --- Serialization ---
const saveSource = await populateMixedWorld(MEDIUM_CAPACITY);
const saveLoadTarget = await populateMixedWorld(MEDIUM_CAPACITY);
const saveBuffer = new Uint8Array(measureWorldSave(saveSource.world) + 1024);
const savedBytes = saveWorld(saveSource.world);
const savedSmall = saveWorld((await populateMixedWorld(SMALL_CAPACITY)).world);
const savedDocument = worldSaveToJSON(savedSmall);

Deno.bench({
  name: "saveWorldInto 8K mixed world - reused buffer",
  group: "serialization",
  baseline: true,
  fn: () => {
    numericSink ^= saveWorldInto(saveSource.world, saveBuffer);
  },
});

Deno.bench({
  name: "saveWorld 8K mixed world - fresh buffer",
  group: "serialization",
  fn: () => {
    objectSink = saveWorld(saveSource.world);
  },
});

Deno.bench({
  name: "loadWorld 8K mixed world into a populated world",
  group: "serialization",
  fn: () => {
    loadWorld(saveLoadTarget.world, savedBytes);
  },
});

Deno.bench({
  name: "worldSaveToJSON + worldSaveFromJSON 1K mixed world",
  group: "serialization",
  fn: () => {
    objectSink = worldSaveFromJSON(worldSaveToJSON(savedSmall));
    objectSink = savedDocument;
  },
});

const namedSource = await populateNamedWorld(MEDIUM_CAPACITY, true);
const namedTarget = await populateNamedWorld(MEDIUM_CAPACITY, true);
const namedBuffer = new Uint8Array(measureWorldSave(namedSource.world) + 1024);
const namedBytes = saveWorld(namedSource.world);

Deno.bench({
  name: "saveWorldInto 8K world with strings + objects - reused buffer",
  group: "serialization",
  fn: () => {
    numericSink ^= saveWorldInto(namedSource.world, namedBuffer);
  },
});

Deno.bench({
  name: "loadWorld 8K world with strings + objects into a populated world",
  group: "serialization",
  fn: () => {
    loadWorld(namedTarget.world, namedBytes);
  },
});

const relationSaveSource = await populateRelationWorld(MEDIUM_CAPACITY, 4_096);
const relationSaveTarget = await populateRelationWorld(MEDIUM_CAPACITY, 2_048);
const relationBuffer = new Uint8Array(measureWorldSave(relationSaveSource.world) + 1024);
const relationBytes = saveWorld(relationSaveSource.world);

Deno.bench({
  name: "saveWorldInto 8K world with 4K-node relations - reused buffer",
  group: "serialization",
  fn: () => {
    numericSink ^= saveWorldInto(relationSaveSource.world, relationBuffer);
  },
});

Deno.bench({
  name: "loadWorld 8K world with 4K-node relations into a populated world",
  group: "serialization",
  fn: () => {
    loadWorld(relationSaveTarget.world, relationBytes);
  },
});

if (entitySink === Number.MIN_SAFE_INTEGER || numericSink === Number.MIN_SAFE_INTEGER || objectSink === null) {
  throw new Error("unreachable benchmark sink");
}
