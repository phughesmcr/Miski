/// <reference lib="deno.ns" />
/// <reference lib="dom" />
// deno-lint-ignore-file no-console no-top-level-await -- bench scripts are entry points that build their worlds at module load and print their reports

import { getHeapSpaceStatistics, getHeapStatistics } from "node:v8";
import {
  CommandBuffer,
  Component,
  entityIndex,
  field,
  loadWorld,
  Prefab,
  Query,
  Relation,
  saveWorld,
  World,
} from "../mod.ts";
import type { ComponentInstance, Entity, PendingEntity } from "../mod.ts";
import {
  countEntities,
  createBenchmarkComponents,
  createDispatchSchedule,
  createMovementQuery,
  createRenderableQuery,
  createWideQuery,
  type Health,
  MEDIUM_CAPACITY,
  mustCreateEntity,
  populateMixedWorld,
  populateMovementWorld,
  populateNamedWorld,
  populateRelationWorld,
  populateScheduledMovementWorld,
  populateSparseLifecycleWorld,
  populateWideWorld,
  type RenderState,
  SMALL_CAPACITY,
  type Vec2,
} from "./fixtures.ts";

type GcFn = () => void;

type Scenario = {
  name: string;
  iterations: number;
  fn: () => void;
  rounds?: number;
  warmupIterations?: number;
  maxSteadyStateBeforeGcBytesPerIter?: number;
};

type MemorySnapshot = ReturnType<typeof Deno.memoryUsage>;
type RoundMeasurement = {
  beforeGc: MemorySnapshot;
  retainedAfterGc: MemorySnapshot;
  /** Bytes V8 allocated during the round that the heap diff does not show: a GC ran inside it. */
  hiddenByGc: number;
};
type RoundKey = "beforeGc" | "retainedAfterGc";
type ScenarioSummary = {
  scenario: Scenario;
  lowestBeforeGc: MemorySnapshot;
  lowestRetainedAfterGc: MemorySnapshot;
  highestSteadyStateBeforeGc: MemorySnapshot;
  /** Largest {@link RoundMeasurement.hiddenByGc} of any round. */
  hiddenByGc: number;
};

const DEFAULT_ROUNDS = 3;
const DEFAULT_WARMUP_ITERATIONS = 10_000;
const ZERO_ALLOC_BUDGET_BYTES_PER_ITER = 0.5;
const QUERY_ITERATION_BUDGET_BYTES_PER_ITER = 180;
const WIDE_QUERY_ITERATION_BUDGET_BYTES_PER_ITER = 260;
const CHANGED_ITERATION_BUDGET_BYTES_PER_ITER = ZERO_ALLOC_BUDGET_BYTES_PER_ITER;
// Systems without argCount forward call args through rest/spread, which allocates ~56-58 B per one-arg call
// unless V8 optimises the call site (not guaranteed). Systems with argCount use fixed parameters and allocate nothing.
const SYSTEM_UPDATE_BUDGET_BYTES_PER_ITER = 64;
const FIXED_ARITY_SYSTEM_UPDATE_BUDGET_BYTES_PER_ITER = ZERO_ALLOC_BUDGET_BYTES_PER_ITER;
const FRAME_BUDGET_BYTES_PER_ITER = 128;
const FIXED_ARITY_FRAME_BUDGET_BYTES_PER_ITER = 8;
// Building a World allocates its managers, storage proxies and buffer partitions: measured about 101 KiB (heap plus
// ArrayBuffers) for the mixed components at capacity 256.
const WORLD_CONSTRUCTOR_BUDGET_BYTES_PER_ITER = 120_000;
const PROJECTILE_SPAWN_DESPAWN_BUDGET_BYTES_PER_ITER = 3_200;
const GET_ENTITY_DATA_BUDGET_BYTES_PER_ITER = 80;
// Six-field getEntityData result object (numeric + bool + enum + entity + string + object).
const GET_FIELD_ENTITY_DATA_BUDGET_BYTES_PER_ITER = 160;
const DATA_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER = ZERO_ALLOC_BUDGET_BYTES_PER_ITER;
const BATCH_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER = ZERO_ALLOC_BUDGET_BYTES_PER_ITER;
const REFRESH_BUDGET_BYTES_PER_ITER = 800;
const QUERY_TRANSITION_TRACKING_BUDGET_BYTES_PER_ITER = 1_800;
const WIDE_ARCHETYPE_TRANSITION_BUDGET_BYTES_PER_ITER = 1_100;
// A scheduled frame runs the same work as the manual argCount frame, so it shares that budget.
const SCHEDULED_FRAME_BUDGET_BYTES_PER_ITER = FIXED_ARITY_FRAME_BUDGET_BYTES_PER_ITER;
// Load validates into cached scratch and builds one small view per saved array: O(components + archetypes), not
// O(entities). Measured about 10.4 KiB/iter on the mixed 8K world, the same at capacities 1K to 32K.
const WORLD_LOAD_BUDGET_BYTES_PER_ITER = 12_000;
// Object fields are saved through user encode hooks (exempt from the zero-allocation rule). This codec returns a
// stored string, so the budget covers Miski's own cost: none, measured 0 B/iter on 1,024 objects.
const OBJECT_SAVE_BUDGET_BYTES_PER_ITER = ZERO_ALLOC_BUDGET_BYTES_PER_ITER;
// A relation load rebuilds each store's pair index (O(pairs) typed arrays), so it scales with the 16K saved pairs.
// Measured about 508 KiB/iter (851 KiB before validation's target order was reused). Few iterations: the arrays are
// external memory, and past ~64 MiB in a round V8 collects them mid-round, which hides them from this count.
const RELATION_LOAD_BUDGET_BYTES_PER_ITER = 600_000;
const checkMode = Deno.args.includes("--check");
// `--only=<text>` runs just the scenarios whose name contains <text>, to check one without the others warming it up.
const onlyFilter = Deno.args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);

const gc = (globalThis as { gc?: GcFn }).gc;

// A round's "before GC" figure is the heap growth across it, which only counts every allocation if no GC runs inside
// the round. The task pins a 64 MiB young generation, so a scavenge needs about 64 MiB of garbage; V8's cumulative
// allocation counter then shows the bytes the heap diff lost, and the round fails instead of passing on an undercount.
const RUN_COMMAND = "deno task bench:gc (or deno run --v8-flags=--expose-gc,--min-semi-space-size=64," +
  "--max-semi-space-size=64 bench/gc-allocations.bench.ts)";
const MIN_YOUNG_GENERATION_BYTES = 48 * 1024 * 1024;
// The counter drifts by up to ~1.5 MiB per round with no allocation at all, so only a larger gap means a GC. It counts
// heap allocations only: a GC forced by ArrayBuffer (external) pressure that frees little heap would go unnoticed, so
// keep a round's external allocation well below the heap's.
const HIDDEN_BY_GC_THRESHOLD_BYTES = 8 * 1024 * 1024;

if (typeof gc !== "function") {
  throw new Error(`Run with: ${RUN_COMMAND}`);
}

const forceGc: GcFn = gc;

function totalAllocatedBytes(): number {
  return (getHeapStatistics() as unknown as { total_allocated_bytes: number }).total_allocated_bytes;
}

function youngGenerationBytes(): number {
  forceGc();
  return getHeapSpaceStatistics().find((space) => space.space_name === "new_space")?.space_available_size ?? 0;
}

if (typeof totalAllocatedBytes() !== "number") {
  throw new Error("This runtime's node:v8 getHeapStatistics() has no total_allocated_bytes.");
}
if (youngGenerationBytes() < MIN_YOUNG_GENERATION_BYTES) {
  throw new Error(
    `The young generation is too small to measure rounds without a GC inside them. Run with: ${RUN_COMMAND}`,
  );
}

// Deno.memoryUsage is JavaScript and runs inside each measured window; let it reach its optimized tiers first, or its
// compiled code lands in whichever round happens to make the call that tiers it up.
for (let i = 0; i < 10_000; i++) Deno.memoryUsage();

function collect(): void {
  for (let i = 0; i < 3; i++) {
    forceGc();
  }
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MiB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(2)} KiB`;
  return `${sign}${abs} B`;
}

function diff(after: MemorySnapshot, before: MemorySnapshot): MemorySnapshot {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
  };
}

function totalBytes(delta: MemorySnapshot): number {
  return delta.heapUsed + delta.external;
}

function bytesPerIteration(delta: MemorySnapshot, iterations: number): number {
  return totalBytes(delta) / iterations;
}

function printRow(label: string, delta: MemorySnapshot, iterations: number): void {
  const bytesPerIter = bytesPerIteration(delta, iterations);
  console.log(
    [
      label.padEnd(42),
      `heap=${formatBytes(delta.heapUsed)}`.padStart(18),
      `external=${formatBytes(delta.external)}`.padStart(22),
      `rss=${formatBytes(delta.rss)}`.padStart(18),
      `approx/iter=${formatBytes(bytesPerIter)}`.padStart(24),
    ].join("  "),
  );
}

function measureRound(scenario: Scenario): RoundMeasurement {
  collect();
  const allocatedBefore = totalAllocatedBytes();
  const before = Deno.memoryUsage();
  repeat(scenario.fn, scenario.iterations);
  const beforeCollection = Deno.memoryUsage();
  const allocated = totalAllocatedBytes() - allocatedBefore;
  collect();
  const afterCollection = Deno.memoryUsage();
  const beforeGc = diff(beforeCollection, before);

  return {
    beforeGc,
    retainedAfterGc: diff(afterCollection, before),
    hiddenByGc: allocated - beforeGc.heapUsed,
  };
}

/** The measured loop. Warmup runs through it too, so a round never pays for compiling the harness itself. */
function repeat(fn: () => void, iterations: number): void {
  for (let i = 0; i < iterations; i++) fn();
}

function warmupScenario(scenario: Scenario): void {
  // An explicit warmup may exceed the measured iterations; the default is capped by them.
  const iterations = scenario.warmupIterations ?? Math.min(scenario.iterations, DEFAULT_WARMUP_ITERATIONS);
  // One iteration per call: many calls optimize `repeat` as a whole. A few long calls would only optimize its loop
  // on-stack, and its regular compile would then land in a measured round.
  for (let i = 0; i < iterations; i++) repeat(scenario.fn, 1);
  collect();
}

function selectLowestAllocRound(rounds: RoundMeasurement[], key: RoundKey): MemorySnapshot {
  let best = rounds[0]![key];
  for (let i = 1; i < rounds.length; i++) {
    const candidate = rounds[i]![key];
    if (totalBytes(candidate) < totalBytes(best)) {
      best = candidate;
    }
  }
  return best;
}

function selectHighestAllocRound(
  rounds: RoundMeasurement[],
  key: RoundKey,
  startRound: number,
): MemorySnapshot {
  let worst = rounds[startRound]![key];
  for (let i = startRound + 1; i < rounds.length; i++) {
    const candidate = rounds[i]![key];
    if (totalBytes(candidate) > totalBytes(worst)) {
      worst = candidate;
    }
  }
  return worst;
}

function runScenario(scenario: Scenario): ScenarioSummary {
  const roundCount = scenario.rounds ?? DEFAULT_ROUNDS;
  const rounds = new Array<RoundMeasurement>(roundCount);

  console.log(`\n${scenario.name} (${scenario.iterations.toLocaleString()} iterations)`);
  warmupScenario(scenario);
  for (let round = 0; round < roundCount; round++) {
    const measurement = measureRound(scenario);
    rounds[round] = measurement;
    printRow(`round ${round + 1} before GC`, measurement.beforeGc, scenario.iterations);
    printRow(`round ${round + 1} retained after GC`, measurement.retainedAfterGc, scenario.iterations);
  }
  // Only the rounds the budget reads: round 1 may also pay for tiering up and is never checked.
  const hiddenByGc = Math.max(...rounds.slice(roundCount > 1 ? 1 : 0).map((round) => round.hiddenByGc));
  if (hiddenByGc > HIDDEN_BY_GC_THRESHOLD_BYTES) {
    console.log(`a GC ran inside a round and hid about ${formatBytes(hiddenByGc)}; the before-GC rows undercount`);
  }

  const lowestBeforeGc = selectLowestAllocRound(rounds, "beforeGc");
  const lowestRetainedAfterGc = selectLowestAllocRound(rounds, "retainedAfterGc");
  const steadyStateStartRound = roundCount > 1 ? 1 : 0;
  const highestSteadyStateBeforeGc = selectHighestAllocRound(rounds, "beforeGc", steadyStateStartRound);
  printRow("lowest before GC", lowestBeforeGc, scenario.iterations);
  printRow("lowest retained after GC", lowestRetainedAfterGc, scenario.iterations);
  if (roundCount > 1) {
    printRow("highest steady-state before GC", highestSteadyStateBeforeGc, scenario.iterations);
  }

  return {
    scenario,
    lowestBeforeGc,
    lowestRetainedAfterGc,
    highestSteadyStateBeforeGc,
    hiddenByGc,
  };
}

function checkBudgets(summaries: ScenarioSummary[]): boolean {
  let passed = true;
  console.log("\nAllocation budget check");

  for (const summary of summaries) {
    const budget = summary.scenario.maxSteadyStateBeforeGcBytesPerIter;
    if (budget === undefined) continue;

    const actual = bytesPerIteration(summary.highestSteadyStateBeforeGc, summary.scenario.iterations);
    const measured = summary.hiddenByGc <= HIDDEN_BY_GC_THRESHOLD_BYTES;
    const ok = measured && actual <= budget;
    passed &&= ok;
    const status = ok ? "PASS" : "FAIL";
    console.log(
      `${status} ${summary.scenario.name}: highest steady-state before-GC ${
        actual.toFixed(4)
      } B/iter <= ${budget} B/iter${
        measured ? "" : ` (a GC inside a round hid ${formatBytes(summary.hiddenByGc)}; use fewer iterations)`
      }`,
    );
  }

  return passed;
}

function budgeted(name: string, iterations: number, fn: () => void): Scenario {
  return {
    name,
    iterations,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn,
  };
}

const mixed = await populateMixedWorld(MEDIUM_CAPACITY);
// Serialization: a reused caller buffer and a self-load over the mixed 8K world.
const saveTarget = new Uint8Array(saveWorld(mixed.world).byteLength + 1024);
const savedMixed = saveWorld(mixed.world);
// String saves: measured and written as UTF-8 without allocating. Object saves run user encode hooks per object.
const named = await populateNamedWorld(MEDIUM_CAPACITY);
const namedSaveTarget = new Uint8Array(saveWorld(named.world).byteLength + 1024);
const meshed = await populateNamedWorld(MEDIUM_CAPACITY, true);
const meshedSaveTarget = new Uint8Array(saveWorld(meshed.world).byteLength + 1024);
// Relation saves: pair pools, pair lists and pair data are written straight from the relation stores.
const relationSave = await populateRelationWorld(MEDIUM_CAPACITY, 4_096);
const relationSaveTarget = new Uint8Array(saveWorld(relationSave.world).byteLength + 1024);
const savedRelations = saveWorld(relationSave.world);
const movement = await populateMovementWorld(MEDIUM_CAPACITY);
const fixedArityMovement = await populateMovementWorld(MEDIUM_CAPACITY, undefined, 1);
const lifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const repeatedSpawnLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const bundledSpawnLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const batchTagTransitions = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const batchDataTransitions = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const transitionTracking = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const wide = await populateWideWorld(SMALL_CAPACITY);
const movementQuery = createMovementQuery(mixed.components);
const renderableQuery = createRenderableQuery(mixed.components);
const renderIncludeQuery = new Query({
  all: [mixed.components.position],
  include: [mixed.components.health, mixed.components.renderState],
});
const movementFrameQuery = createMovementQuery(movement.components);
const renderableFrameQuery = createRenderableQuery(movement.components);
const fixedArityRenderableFrameQuery = createRenderableQuery(fixedArityMovement.components);
const batchTagPositionQuery = new Query({ all: [batchTagTransitions.components.position] });
const batchDataPositionQuery = new Query({ all: [batchDataTransitions.components.position] });
const transitionTrackingQuery = createMovementQuery(transitionTracking.components);
const wideQuery = createWideQuery(wide.components);
// A tag every query-refill entity carries, so each spawn/tag/destroy changes the query's only archetype.
const refillTag = new Component<null>({ name: "refillTag" });
const refillWorld = new World({ capacity: MEDIUM_CAPACITY, components: [refillTag] });
await refillWorld.init();
for (let i = 0; i < 4_096; i++) refillWorld.components.addToEntity(refillTag, mustCreateEntity(refillWorld));
const refillQuery = new Query({ all: [refillTag] });
refillWorld.refresh();
// Nested loops: every query() / getActive() call gets its own pooled cursor, so depth-2 nesting reuses two.
const nestedTag = new Component<null>({ name: "nestedTag" });
const nestedWorld = new World({ capacity: SMALL_CAPACITY, components: [nestedTag] });
await nestedWorld.init();
for (let i = 0; i < 32; i++) nestedWorld.components.addToEntity(nestedTag, mustCreateEntity(nestedWorld));
const nestedQuery = new Query({ all: [nestedTag] });
nestedWorld.refresh();
// Relations: a 1,024-node 4-ary hierarchy plus multi-target and exclusive data relations.
const rel = await populateRelationWorld(MEDIUM_CAPACITY);
const relLeafA = rel.entities[1_000]!;
const relLeafB = rel.entities[1_001]!;
const relParentA = rel.entities[10]!;
const relParentB = rel.entities[20]!;
const relHub = rel.entities[300]!;
const relPositionQuery = new Query({ all: [rel.position, rel.likes] });
const relAimsOut = { weight: 0 };
let relToggle = false;
// Warm every pooled list and the pair pool before measurement.
rel.world.relations.getSources(rel.childOf, rel.entities[0]!);
rel.world.relations.getTargets(rel.likes, relLeafA);
rel.world.relations.queryList(rel.likes, relHub, relPositionQuery);
rel.world.relations.traverse(rel.childOf);
rel.world.relations.add(rel.likes, relLeafA, relHub);
rel.world.relations.remove(rel.likes, relLeafA, relHub);
mixed.world.entities.query(movementQuery);
mixed.world.entities.query(renderableQuery);
mixed.world.entities.query(renderIncludeQuery);
mixed.world.components.query(renderIncludeQuery);
movement.world.entities.query(movementFrameQuery);
movement.world.entities.query(renderableFrameQuery);
fixedArityMovement.world.entities.query(fixedArityRenderableFrameQuery);
batchTagTransitions.world.entities.query(batchTagPositionQuery);
batchDataTransitions.world.entities.query(batchDataPositionQuery);
transitionTracking.world.entities.query(transitionTrackingQuery);
wide.world.entities.query(wideQuery);

const positionInstance = mixed.world.components.getInstance(mixed.components.position) as ComponentInstance<Vec2>;
const positionStorage = positionInstance.storage;
const positionProxy = positionInstance.proxy;
if (positionStorage === null || positionProxy === null) {
  throw new Error("GC benchmark expected position component storage");
}
const healthInstance = mixed.world.components.getInstance(mixed.components.health) as ComponentInstance<Health>;
const healthPartitions = healthInstance.storage.partitions;
const renderStateInstance = mixed.world.components.getInstance(mixed.components.renderState) as ComponentInstance<
  RenderState
>;
const renderStatePartitions = renderStateInstance.storage.partitions;
const positionData = { x: 0, y: 0 };
const positionReadOut = { x: 0, y: 0 };
const transitionVelocityData = { x: 1, y: -1 };
const mutationEntity = mixed.entities[128]!;
const mutationSlot = entityIndex(mutationEntity);
const healthOwnerEntity = mixed.entities[129]!;
const transitionEntity = mustCreateEntity(lifecycle.world);
const enteredExitedEntity = mustCreateEntity(transitionTracking.world);
const wideTransitionEntity = mustCreateEntity(wide.world);
const batchData = { x: 1, y: -1 };
lifecycle.world.components.addToEntity(lifecycle.components.position, transitionEntity, { x: 0, y: 0 });
lifecycle.world.refresh();
transitionTracking.world.components.addToEntity(transitionTracking.components.position, enteredExitedEntity, {
  x: 0,
  y: 0,
});
transitionTracking.world.refresh();
wide.world.components.addToEntity(wide.components.all[0]!, wideTransitionEntity);
wide.world.components.addToEntity(wide.components.all[31]!, wideTransitionEntity);
wide.world.refresh();
const batchEntities = new Array<Entity>(128);
const repeatedSpawnEntities = new Array<Entity>(128);
const bundledSpawnEntities = new Array<Entity>(128);
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
  const { x, y } = world.components.getInstanceOrThrow(prefabComponents.position).storage.partitions;
  const sprite = world.components.getInstanceOrThrow(prefabComponents.renderState).storage.partitions.sprite;
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
let entitySink = 0;
let numericSink = 0;
let objectSink: unknown;

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
    out[i] = bundledSpawnLifecycle.world.entities.createOrThrow(bundledProjectileBundle);
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

class GcMesh {
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
    mesh: field.object<GcMesh>(),
  },
});
const fieldWorld = new World({ capacity: SMALL_CAPACITY, components: [fieldUnit] });
await fieldWorld.init();
const fieldMeshes = [new GcMesh(0), new GcMesh(1)];
const fieldLabels = ["a", "b"];
const fieldStates = ["idle", "run"] as const;
const fieldTarget = mustCreateEntity(fieldWorld);
const fieldEntity = fieldWorld.entities.createOrThrow([[fieldUnit, { label: "x" }]]);
const fieldTransitionEntity = mustCreateEntity(fieldWorld);
const fieldInstance = fieldWorld.components.getInstanceOrThrow(fieldUnit);
const fieldProxy = fieldInstance.proxy;
const fieldWriteData = {
  hp: 0,
  alive: false,
  state: "idle" as "idle" | "run" | "dead",
  target: fieldTarget as Entity | null,
  label: "a",
  mesh: fieldMeshes[0]! as GcMesh | null,
};
const fieldReadOut = { ...fieldWriteData };
const dispatch = await createDispatchSchedule(16);
const scheduledMovement = await populateScheduledMovementWorld(MEDIUM_CAPACITY);
const commandTransitions = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const commandTransitionBuffer = new CommandBuffer(commandTransitions.world);
const commandTransitionEntities = commandTransitions.world.entities
  .querySnapshot(new Query({ all: [commandTransitions.components.position] }))
  .slice(0, 128);
const commandAccelerationData = { x: 0, y: 1 };
const commandPositionData = { x: 0 };
const commandSpawnLifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const commandSpawnBuffer = new CommandBuffer(commandSpawnLifecycle.world);
const commandSpawnQuery = new Query({ all: [commandSpawnLifecycle.components.lifetime] });
const commandProjectilePositionData = { x: 0, y: 0 };
const commandProjectileVelocityData = { x: 10, y: -2 };
const commandProjectileLifetimeData = { ttl: 2 };
const commandProjectileRenderData = { sprite: 0, layer: 2 };
const commandProjectileBundle = [
  [commandSpawnLifecycle.components.position, commandProjectilePositionData],
  [commandSpawnLifecycle.components.velocity, commandProjectileVelocityData],
  [commandSpawnLifecycle.components.lifetime, commandProjectileLifetimeData],
  [commandSpawnLifecycle.components.renderState, commandProjectileRenderData],
  [commandSpawnLifecycle.components.renderable],
] as const;

function commandSpawnDespawnBatch(): void {
  for (let i = 0; i < 128; i++) {
    commandProjectilePositionData.x = i;
    commandProjectileRenderData.sprite = i & 15;
    commandSpawnBuffer.spawn(commandProjectileBundle);
  }
  commandSpawnBuffer.flush();
  const list = commandSpawnLifecycle.world.entities.queryList(commandSpawnQuery);
  entitySink ^= list.count;
  for (let i = 0; i < list.count; i++) {
    commandSpawnBuffer.destroy(list.entities[i]!);
  }
  commandSpawnBuffer.flush();
  commandSpawnLifecycle.world.refresh();
}

function commandTransitionBatch(round: number): void {
  commandAccelerationData.x = round & 7;
  commandPositionData.x = round & 15;
  for (let i = 0; i < commandTransitionEntities.length; i++) {
    const entity = commandTransitionEntities[i]!;
    commandTransitionBuffer.add(commandTransitions.components.acceleration, entity, commandAccelerationData);
    commandTransitionBuffer.set(commandTransitions.components.position, entity, commandPositionData);
  }
  commandTransitionBuffer.flush();
  for (let i = 0; i < commandTransitionEntities.length; i++) {
    commandTransitionBuffer.remove(commandTransitions.components.acceleration, commandTransitionEntities[i]!);
  }
  commandTransitionBuffer.flush();
}

let commandRound = 0;

// Side-column payloads: field.* values (here an enum label) go through the buffer's side column.
const sideLabels = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p"] as const;
const sidePoint = new Component({ name: "sidePoint", schema: { x: field.enum(sideLabels), y: Float32Array } });
const sideWorld = new World({ capacity: SMALL_CAPACITY, components: [sidePoint] });
await sideWorld.init();
const sideEntities: Entity[] = [];
for (let i = 0; i < 128; i++) {
  const entity = mustCreateEntity(sideWorld);
  sideWorld.components.addToEntity(sidePoint, entity, { x: "a", y: 0 });
  sideEntities.push(entity);
}
sideWorld.refresh();
const sideBuffer = new CommandBuffer(sideWorld);
const sideData: { x: (typeof sideLabels)[number]; y: number } = { x: "a", y: 0 };

function commandSideColumnBatch(round: number): void {
  sideData.x = sideLabels[round & 15]!;
  sideData.y = round & 7;
  for (let i = 0; i < sideEntities.length; i++) sideBuffer.set(sidePoint, sideEntities[i]!, sideData);
  sideBuffer.flush();
  sideWorld.refresh();
}

// Deferred relation commands with pending entities: a parent and a child that points at it, spawned in one buffer.
const pendingNode = new Component({ name: "pendingNode", schema: { parent: field.entity(), depth: Uint8Array } });
const pendingChildOf = new Relation({ name: "pendingChildOf", exclusive: true, acyclic: true });
const pendingLinks = new Relation({ name: "pendingLinks", schema: { weight: Float32Array } });
const pendingWorld = new World({ capacity: SMALL_CAPACITY, components: [pendingNode, pendingChildOf, pendingLinks] });
await pendingWorld.init();
const pendingRoot = mustCreateEntity(pendingWorld);
const pendingBuffer = new CommandBuffer(pendingWorld);
const pendingNodeQuery = new Query({ all: [pendingNode] });
const pendingParentData: { parent: Entity | PendingEntity | null; depth: number } = { parent: null, depth: 0 };
const pendingChildData: { parent: Entity | PendingEntity | null; depth: number } = { parent: null, depth: 1 };
const pendingLinkData = { weight: 0 };

function commandPendingRelationBatch(round: number): void {
  pendingLinkData.weight = round & 7;
  for (let i = 0; i < 32; i++) {
    pendingParentData.parent = pendingRoot;
    // Bundles are added with `add`: a direct `create(bundle)` of a component with `field.*` columns allocates today.
    const parent = pendingBuffer.spawn();
    pendingBuffer.add(pendingNode, parent, pendingParentData);
    pendingChildData.parent = parent;
    const child = pendingBuffer.spawn();
    pendingBuffer.add(pendingNode, child, pendingChildData);
    pendingBuffer.relate(pendingChildOf, parent, pendingRoot);
    pendingBuffer.relate(pendingChildOf, child, parent);
    pendingBuffer.relate(pendingLinks, child, pendingRoot, pendingLinkData);
    pendingBuffer.unrelate(pendingLinks, child, pendingRoot);
  }
  pendingBuffer.flush();
  const list = pendingWorld.entities.queryList(pendingNodeQuery);
  entitySink ^= list.count;
  for (let i = 0; i < list.count; i++) pendingBuffer.destroy(list.entities[i]!);
  pendingBuffer.flush();
  pendingWorld.refresh();
}

const scenarios: Scenario[] = [
  {
    name: "world constructor allocating",
    // Each World allocates tens of KiB, so a round must stay small enough to fit the young generation (see
    // HIDDEN_BY_GC_THRESHOLD_BYTES); the warmup still runs thousands of constructions.
    iterations: 250,
    warmupIterations: 2_000,
    maxSteadyStateBeforeGcBytesPerIter: WORLD_CONSTRUCTOR_BUDGET_BYTES_PER_ITER,
    fn: () => {
      objectSink = new World({ capacity: 256, components: mixed.components.all });
    },
  },
  budgeted("entity create/destroy recycled hot path + refresh", 250_000, () => {
    const entity = mustCreateEntity(lifecycle.world);
    lifecycle.world.entities.destroy(entity);
    entitySink ^= entity;
    lifecycle.world.refresh();
  }),
  budgeted("isActive and entityHas hot checks", 250_000, () => {
    numericSink ^= mixed.world.entities.isActive(mutationEntity) ? 1 : 0;
    numericSink ^= mixed.world.components.entityHas(mixed.components.position, mutationEntity) ? 1 : 0;
  }),
  budgeted("instance.has hot ownership check", 250_000, () => {
    numericSink ^= healthInstance.has(healthOwnerEntity) ? 1 : 0;
  }),
  {
    name: "batch create/destroy 128 allocating control array reused + refresh",
    iterations: 50_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      for (let i = 0; i < batchEntities.length; i++) {
        batchEntities[i] = mustCreateEntity(lifecycle.world);
      }
      for (let i = 0; i < batchEntities.length; i++) {
        lifecycle.world.entities.destroy(batchEntities[i]!);
      }
      entitySink ^= batchEntities[0]!;
      lifecycle.world.refresh();
    },
  },
  {
    name: "spawn/despawn 128 projectiles - repeated addToEntity + refresh",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: PROJECTILE_SPAWN_DESPAWN_BUDGET_BYTES_PER_ITER,
    fn: () => {
      spawnProjectileBatchRepeated(repeatedSpawnEntities);
      destroyRepeatedBatch(repeatedSpawnEntities);
      entitySink ^= repeatedSpawnEntities[0]!;
      repeatedSpawnLifecycle.world.refresh();
    },
  },
  {
    name: "spawn/despawn 128 projectiles - create(bundle) + refresh",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      spawnProjectileBatchWithCreateWith(bundledSpawnEntities);
      destroyBundledBatch(bundledSpawnEntities);
      entitySink ^= bundledSpawnEntities[0]!;
      bundledSpawnLifecycle.world.refresh();
    },
  },
  {
    name: "spawn/despawn 128 projectiles - prefab instantiate + overrides + refresh",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      spawnProjectileBatchWithPrefab(prefabSpawnEntities);
      destroyPrefabBatch(prefabSpawnEntities);
      entitySink ^= prefabSpawnEntities[0]!;
      prefabSpawnLifecycle.world.refresh();
    },
  },
  {
    name: "spawn/despawn 128 projectiles - prefab instantiateMany + slot writes + refresh",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: spawnProjectileBatchWithInstantiateMany,
  },
  budgeted("direct typed-array component writes", 250_000, () => {
    positionStorage.partitions.x[mutationSlot] = (positionStorage.partitions.x[mutationSlot] ?? 0) + 1;
    positionStorage.partitions.y[mutationSlot] = (positionStorage.partitions.y[mutationSlot] ?? 0) - 1;
  }),
  budgeted("direct typed-array writes + instance.markChanged", 250_000, () => {
    positionStorage.partitions.x[mutationSlot] = (positionStorage.partitions.x[mutationSlot] ?? 0) + 1;
    positionStorage.partitions.y[mutationSlot] = (positionStorage.partitions.y[mutationSlot] ?? 0) - 1;
    numericSink ^= positionInstance.markChanged(mutationEntity) ? 1 : 0;
  }),
  budgeted("proxy component writes with changed tracking", 250_000, () => {
    positionProxy.entity = mutationEntity;
    positionProxy.x = numericSink++;
    positionProxy.y = -numericSink;
  }),
  budgeted("instance.set numeric writes with changed tracking", 250_000, () => {
    positionInstance.set(mutationEntity, "x", numericSink++);
    positionInstance.set(mutationEntity, "y", -numericSink);
  }),
  budgeted("setEntityData with reused data object", 250_000, () => {
    positionData.x = numericSink++;
    positionData.y = -numericSink;
    mixed.world.components.setEntityData(mixed.components.position, mutationEntity, positionData);
  }),
  {
    name: "getEntityDataOrThrow allocating object materialization",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: GET_ENTITY_DATA_BUDGET_BYTES_PER_ITER,
    fn: () => {
      objectSink = mixed.world.components.getEntityDataOrThrow(mixed.components.position, mutationEntity);
    },
  },
  budgeted("readEntityDataInto reused output object", 250_000, () => {
    numericSink ^=
      mixed.world.components.readEntityDataInto(mixed.components.position, mutationEntity, positionReadOut) ? 1 : 0;
  }),
  {
    name: "cached query entity iteration",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: QUERY_ITERATION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      entitySink ^= countEntities(mixed.world.entities.query(movementQuery));
    },
  },
  budgeted("nested query entity iteration (depth 2)", 10_000, () => {
    let pairs = 0;
    for (const _outer of nestedWorld.entities.query(nestedQuery)) {
      for (const _inner of nestedWorld.entities.query(nestedQuery)) pairs++;
    }
    entitySink ^= pairs;
  }),
  {
    name: "getActive dense iteration",
    iterations: 5_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    // Each pass walks 8K entities; with only the default warmup the loop tiers up during a measured round and its
    // compiled code (about 25 KiB) lands in the budget. A longer warmup settles it first.
    warmupIterations: 20_000,
    fn: () => {
      entitySink ^= countEntities(mixed.world.entities.getActive());
    },
  },
  budgeted("nested getActive iteration (depth 2)", 10_000, () => {
    let pairs = 0;
    for (const _outer of nestedWorld.entities.getActive()) {
      for (const _inner of nestedWorld.entities.getActive()) pairs++;
    }
    entitySink ^= pairs;
  }),
  {
    name: "queryList cached entity iteration",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      const result = mixed.world.entities.queryList(movementQuery);
      let count = 0;
      for (let i = 0; i < result.count; i++) count++;
      entitySink ^= count;
    },
  },
  {
    name: "queryList cached entity iteration - all + include",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      const result = mixed.world.entities.queryList(renderIncludeQuery);
      let count = 0;
      for (let i = 0; i < result.count; i++) count++;
      entitySink ^= count;
    },
  },
  {
    name: "render loop direct partitions + include ownership checks",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
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
  },
  {
    name: "querySnapshot allocating convenience helper",
    // About 32 KiB per snapshot: keep a round inside the young generation.
    iterations: 1_000,
    fn: () => {
      objectSink = mixed.world.entities.querySnapshot(movementQuery);
    },
  },
  {
    name: "snapshot helpers allocating convenience baseline",
    // About 500 KiB per iteration: keep a round inside the young generation.
    iterations: 50,
    fn: () => {
      objectSink = mixed.world.entities.getActiveSnapshot();
      objectSink = mixed.world.components.getOwnersSnapshot(mixed.components.position);
      objectSink = mixed.world.components.getChangedSnapshot(mixed.components.position);
      objectSink = mixed.world.entities.toArray(mixed.world.entities.queryList(movementQuery));
    },
  },
  {
    name: "component changed dense iterator",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: CHANGED_ITERATION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      entitySink ^= countEntities(mixed.world.components.getChanged(mixed.components.position));
    },
  },
  {
    name: "component owners iterator",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: CHANGED_ITERATION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      entitySink ^= countEntities(mixed.world.components.getOwners(mixed.components.position));
    },
  },
  {
    name: "add/remove data component runtime transition",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: DATA_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      lifecycle.world.components.addToEntity(
        lifecycle.components.velocity,
        transitionEntity,
        transitionVelocityData,
      );
      lifecycle.world.components.removeFromEntity(lifecycle.components.velocity, transitionEntity);
    },
  },
  {
    name: "bulk add/remove tag component across queryList - 896 entities",
    iterations: 40_000,
    // Batch move paths keep tiering up past 10k calls; a recompile inside a round adds a fixed ~4-5 KiB, so long rounds
    // keep that below the per-iteration budget.
    warmupIterations: 40_000,
    maxSteadyStateBeforeGcBytesPerIter: BATCH_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      // SMALL_CAPACITY sparse lifecycle fixtures leave 896 active positioned entities.
      const positioned = batchTagTransitions.world.entities.queryList(batchTagPositionQuery);
      batchTagTransitions.world.components.addToEntities(batchTagTransitions.components.renderable, positioned);
      const positionedAfterAdd = batchTagTransitions.world.entities.queryList(batchTagPositionQuery);
      batchTagTransitions.world.components.removeFromEntities(
        batchTagTransitions.components.renderable,
        positionedAfterAdd,
      );
    },
  },
  {
    name: "bulk add/remove data component across queryList - 896 entities",
    iterations: 40_000,
    // Same one-off recompile cost per round as the tag scenario above (~6 KiB in one round, 0 B in the next).
    maxSteadyStateBeforeGcBytesPerIter: BATCH_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      // SMALL_CAPACITY sparse lifecycle fixtures leave 896 active positioned entities.
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
  },
  {
    name: "entered/exited query transition tracking",
    iterations: 50_000,
    maxSteadyStateBeforeGcBytesPerIter: QUERY_TRANSITION_TRACKING_BUDGET_BYTES_PER_ITER,
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
  },
  {
    name: "64-component world cached query",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: WIDE_QUERY_ITERATION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      entitySink ^= countEntities(wide.world.entities.query(wideQuery));
    },
  },
  {
    name: "64-component world archetype transition",
    iterations: 50_000,
    maxSteadyStateBeforeGcBytesPerIter: WIDE_ARCHETYPE_TRANSITION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      wide.world.components.addToEntity(wide.components.all[63]!, wideTransitionEntity);
      entitySink ^= countEntities(wide.world.entities.query(wideQuery));
      wide.world.components.removeFromEntity(wide.components.all[63]!, wideTransitionEntity);
    },
  },
  {
    name: "system movement update cached query",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: SYSTEM_UPDATE_BUDGET_BYTES_PER_ITER,
    fn: () => {
      movement.movement(1 / 60);
    },
  },
  {
    name: "system movement update cached query, argCount",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: FIXED_ARITY_SYSTEM_UPDATE_BUDGET_BYTES_PER_ITER,
    fn: () => {
      fixedArityMovement.movement(1 / 60);
    },
  },
  {
    name: "world refresh standalone with cached queries",
    iterations: 25_000,
    maxSteadyStateBeforeGcBytesPerIter: REFRESH_BUDGET_BYTES_PER_ITER,
    fn: () => {
      movement.world.refresh();
    },
  },
  {
    name: "game frame system + cached render query + refresh",
    iterations: 5_000,
    maxSteadyStateBeforeGcBytesPerIter: FRAME_BUDGET_BYTES_PER_ITER,
    fn: () => {
      movement.movement(1 / 60);
      entitySink ^= countEntities(movement.world.entities.query(renderableFrameQuery));
      movement.world.refresh();
    },
  },
  {
    name: "game frame argCount system + cached render query + refresh",
    iterations: 5_000,
    maxSteadyStateBeforeGcBytesPerIter: FIXED_ARITY_FRAME_BUDGET_BYTES_PER_ITER,
    fn: () => {
      fixedArityMovement.movement(1 / 60);
      entitySink ^= countEntities(fixedArityMovement.world.entities.query(fixedArityRenderableFrameQuery));
      fixedArityMovement.world.refresh();
    },
  },
  budgeted("proxy writes of bool/enum/entity/string/object fields", 250_000, () => {
    const i = numericSink++;
    fieldProxy.entity = fieldEntity;
    fieldProxy.alive = (i & 1) === 1;
    fieldProxy.state = fieldStates[i & 1]!;
    fieldProxy.target = (i & 1) === 1 ? fieldTarget : null;
    fieldProxy.label = fieldLabels[i & 1]!;
    fieldProxy.mesh = fieldMeshes[i & 1]!;
    fieldWorld.refresh();
  }),
  budgeted("instance.set of bool/enum/entity/string/object fields", 250_000, () => {
    const i = numericSink++;
    fieldInstance.set(fieldEntity, "alive", (i & 1) === 1);
    fieldInstance.set(fieldEntity, "state", fieldStates[i & 1]!);
    fieldInstance.set(fieldEntity, "target", (i & 1) === 1 ? fieldTarget : null);
    fieldInstance.set(fieldEntity, "label", fieldLabels[i & 1]!);
    fieldInstance.set(fieldEntity, "mesh", fieldMeshes[i & 1]!);
    fieldWorld.refresh();
  }),
  budgeted("proxy reads of bool/enum/entity/string/object fields", 250_000, () => {
    fieldProxy.entity = fieldEntity;
    numericSink ^= fieldProxy.alive ? 1 : 0;
    numericSink ^= fieldProxy.state.length;
    entitySink ^= fieldProxy.target ?? 0;
    numericSink ^= fieldProxy.label.length;
    objectSink = fieldProxy.mesh;
  }),
  budgeted("setEntityData all field kinds with reused data object", 250_000, () => {
    const i = numericSink++;
    fieldWriteData.hp = i & 0xff;
    fieldWriteData.alive = (i & 1) === 1;
    fieldWriteData.state = fieldStates[i & 1]!;
    fieldWriteData.label = fieldLabels[i & 1]!;
    fieldWriteData.mesh = fieldMeshes[i & 1]!;
    fieldWorld.components.setEntityData(fieldUnit, fieldEntity, fieldWriteData);
    fieldWorld.refresh();
  }),
  budgeted("readEntityDataInto all field kinds", 250_000, () => {
    numericSink ^= fieldWorld.components.readEntityDataInto(fieldUnit, fieldEntity, fieldReadOut) ? 1 : 0;
  }),
  {
    name: "getEntityData all field kinds allocating object materialization",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: GET_FIELD_ENTITY_DATA_BUDGET_BYTES_PER_ITER,
    fn: () => {
      objectSink = fieldWorld.components.getEntityDataOrThrow(fieldUnit, fieldEntity);
    },
  },
  budgeted("add/remove component with all field kinds + refresh", 100_000, () => {
    fieldWorld.components.addToEntity(fieldUnit, fieldTransitionEntity);
    fieldWorld.components.removeFromEntity(fieldUnit, fieldTransitionEntity);
    fieldWorld.refresh();
  }),
  budgeted("schedule run dispatch 16 systems (fixed + variable, runIf, disabled) + refresh", 100_000, () => {
    dispatch.schedule.run(1 / 60);
  }),
  {
    name: "scheduled game frame movement + render system + refresh",
    iterations: 5_000,
    maxSteadyStateBeforeGcBytesPerIter: SCHEDULED_FRAME_BUDGET_BYTES_PER_ITER,
    fn: () => {
      scheduledMovement.schedule.run(1 / 60);
    },
  },
  budgeted("command buffer add/set/remove data on 128 live entities + flush", 10_000, () => {
    commandTransitionBatch(commandRound++);
  }),
  budgeted("command buffer spawn/despawn 128 projectile bundles + flush + refresh", 10_000, () => {
    commandSpawnDespawnBatch();
  }),
  budgeted("command buffer set side-column + numeric field on 128 entities + flush", 10_000, () => {
    commandSideColumnBatch(commandRound++);
  }),
  budgeted("command buffer pending parent/child spawn + relate/unrelate + flush", 10_000, () => {
    commandPendingRelationBatch(commandRound++);
  }),
  budgeted("related spawn/tag/destroy + queryList refill of 4096 entities", 20_000, () => {
    const entity = mustCreateEntity(refillWorld);
    refillWorld.components.addToEntity(refillTag, entity);
    refillWorld.entities.destroy(entity);
    entitySink ^= refillWorld.entities.queryList(refillQuery).count;
    refillWorld.refresh();
  }),
  budgeted("relation add/remove multi-target pair", 50_000, () => {
    rel.world.relations.add(rel.likes, relLeafA, relHub);
    rel.world.relations.remove(rel.likes, relLeafA, relHub);
  }),
  {
    name: "exclusive relation retarget",
    iterations: 200_000,
    // Retargeting keeps tiering up past the default warmup; a recompile inside a round adds a fixed ~7-26 KiB
    // (0.14-0.53 B/iter over 50k iterations), so long rounds keep it below the budget.
    warmupIterations: 50_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      relToggle = !relToggle;
      rel.world.relations.add(rel.childOf, relLeafB, relToggle ? relParentA : relParentB);
    },
  },
  budgeted("relation lookups: sources, targets, queryList by target", 50_000, () => {
    entitySink ^= rel.world.relations.getSources(rel.childOf, relParentA).count;
    entitySink ^= rel.world.relations.getTargets(rel.likes, relLeafA).count;
    entitySink ^= rel.world.relations.queryList(rel.likes, relHub, relPositionQuery).count;
    entitySink ^= rel.world.relations.has(rel.likes, relLeafA, relHub) ? 1 : 0;
    entitySink ^= rel.world.relations.hasAny(rel.likes, relLeafA) ? 1 : 0;
    entitySink ^= rel.world.relations.getInstance(rel.aims)!.rowOf(relLeafA, relHub);
    entitySink ^= rel.world.relations.getInstanceOrThrow(rel.likes).rowOf(relLeafA, relHub);
  }),
  budgeted("relation data setData + readDataInto", 50_000, () => {
    relAimsOut.weight = (relAimsOut.weight + 1) % 1_000;
    rel.world.relations.setData(rel.aims, relLeafA, rel.world.relations.getTarget(rel.aims, relLeafA)!, relAimsOut);
    rel.world.relations.readDataInto(
      rel.aims,
      relLeafB,
      rel.world.relations.getTarget(rel.aims, relLeafB)!,
      relAimsOut,
    );
  }),
  {
    name: "hierarchy traverse 1,024 nodes (cached)",
    iterations: 200_000,
    // A cache hit is a revision compare; long rounds keep a one-off recompile (~20 KiB) below the budget.
    warmupIterations: 50_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      entitySink ^= rel.world.relations.traverse(rel.childOf).count;
    },
  },
  {
    name: "hierarchy reparent + traverse 1,024 nodes",
    iterations: 20_000,
    // The traversal loop keeps tiering up past 10k calls; a recompile inside a round adds a fixed ~7 KiB, so long
    // rounds after a long warmup keep that below the per-iteration budget (same remedy as the batch scenarios).
    warmupIterations: 20_000,
    maxSteadyStateBeforeGcBytesPerIter: ZERO_ALLOC_BUDGET_BYTES_PER_ITER,
    fn: () => {
      relToggle = !relToggle;
      rel.world.relations.add(rel.childOf, relLeafA, relToggle ? relParentA : relParentB);
      entitySink ^= rel.world.relations.traverse(rel.childOf).count;
    },
  },
  budgeted("cascade destroy 5-node subtree + rebuild + refresh", 20_000, () => {
    const parent = mustCreateEntity(rel.world);
    rel.world.relations.add(rel.childOf, parent, relHub);
    for (let i = 0; i < 4; i++) rel.world.relations.add(rel.childOf, mustCreateEntity(rel.world), parent);
    rel.world.entities.destroy(parent);
    entitySink ^= countEntities(rel.world.relations.getChanged(rel.childOf));
    rel.world.refresh();
  }),
  {
    ...budgeted("saveWorld 8K mixed world - reused buffer", 4_000, () => {
      numericSink ^= saveWorld(mixed.world, saveTarget).byteLength;
    }),
    // Let the writer reach its optimized tier first; earlier tiers allocate feedback and code once.
    warmupIterations: 30_000,
  },
  {
    ...budgeted("saveWorld 8K world with strings - reused buffer", 4_000, () => {
      numericSink ^= saveWorld(named.world, namedSaveTarget).byteLength;
    }),
    warmupIterations: 30_000,
  },
  {
    ...budgeted("saveWorld 8K world with relations - reused buffer", 4_000, () => {
      numericSink ^= saveWorld(relationSave.world, relationSaveTarget).byteLength;
    }),
    warmupIterations: 30_000,
  },
  {
    name: "saveWorld 8K world with strings + objects - reused buffer",
    iterations: 2_000,
    // Like the saves above: writeSave and measure run once per save and only reach TurboFan after ~7.5K and ~10K
    // calls (again after the first object-column save deoptimizes them). With less warmup their compiled code lands
    // in rounds 2-3 and counts as tens of KiB.
    warmupIterations: 30_000,
    maxSteadyStateBeforeGcBytesPerIter: OBJECT_SAVE_BUDGET_BYTES_PER_ITER,
    fn: () => {
      numericSink ^= saveWorld(meshed.world, meshedSaveTarget).byteLength;
    },
  },
  {
    name: "loadWorld 8K mixed world - self-load",
    iterations: 2_000,
    warmupIterations: 500,
    maxSteadyStateBeforeGcBytesPerIter: WORLD_LOAD_BUDGET_BYTES_PER_ITER,
    fn: () => {
      loadWorld(mixed.world, savedMixed);
    },
  },
  {
    name: "loadWorld 8K world with 4K-node relations - self-load",
    iterations: 30,
    warmupIterations: 100,
    maxSteadyStateBeforeGcBytesPerIter: RELATION_LOAD_BUDGET_BYTES_PER_ITER,
    fn: () => {
      loadWorld(relationSave.world, savedRelations);
    },
  },
];

console.log("Miski ECS GC allocation pressure benchmark");
console.log("Measures memory growth during tight loops, forcing GC between each round.");

const summaries: ScenarioSummary[] = [];
for (const scenario of scenarios) {
  if (onlyFilter !== undefined && !scenario.name.includes(onlyFilter)) continue;
  summaries.push(runScenario(scenario));
}
if (summaries.length === 0) {
  console.error(`No scenario name contains "${onlyFilter}".`);
  Deno.exit(1);
}

if (checkMode && !checkBudgets(summaries)) {
  Deno.exit(1);
}

if (entitySink === Number.MIN_SAFE_INTEGER || numericSink === Number.MIN_SAFE_INTEGER || objectSink === null) {
  console.log("unreachable", entitySink, numericSink, objectSink);
}
