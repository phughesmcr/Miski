/// <reference lib="deno.ns" />
/// <reference lib="dom" />
// deno-lint-ignore-file no-console

import { Query, World } from "../mod.ts";
import type { ComponentInstance, Entity } from "../mod.ts";
import {
  countEntities,
  createMovementQuery,
  createRenderableQuery,
  createWideQuery,
  MEDIUM_CAPACITY,
  mustCreateEntity,
  populateMixedWorld,
  populateMovementWorld,
  populateSparseLifecycleWorld,
  populateWideWorld,
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
};
type ScenarioSummary = {
  scenario: Scenario;
  lowestBeforeGc: MemorySnapshot;
  lowestRetainedAfterGc: MemorySnapshot;
  highestSteadyStateBeforeGc: MemorySnapshot;
};

const DEFAULT_ROUNDS = 3;
const DEFAULT_WARMUP_ITERATIONS = 10_000;
const ZERO_ALLOC_BUDGET_BYTES_PER_ITER = 0.5;
const QUERY_ITERATION_BUDGET_BYTES_PER_ITER = 180;
const WIDE_QUERY_ITERATION_BUDGET_BYTES_PER_ITER = 260;
const CHANGED_ITERATION_BUDGET_BYTES_PER_ITER = ZERO_ALLOC_BUDGET_BYTES_PER_ITER;
const SYSTEM_UPDATE_BUDGET_BYTES_PER_ITER = 220;
const FRAME_BUDGET_BYTES_PER_ITER = 2_700;
const WORLD_CONSTRUCTOR_BUDGET_BYTES_PER_ITER = 12_000;
const PROJECTILE_SPAWN_DESPAWN_BUDGET_BYTES_PER_ITER = 3_200;
const GET_ENTITY_DATA_BUDGET_BYTES_PER_ITER = 80;
const DATA_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER = 60;
const BATCH_COMPONENT_TRANSITION_BUDGET_BYTES_PER_ITER = 1_700;
const REFRESH_BUDGET_BYTES_PER_ITER = 800;
const QUERY_TRANSITION_TRACKING_BUDGET_BYTES_PER_ITER = 1_800;
const WIDE_ARCHETYPE_TRANSITION_BUDGET_BYTES_PER_ITER = 1_100;
const checkMode = Deno.args.includes("--check");

const gc = (globalThis as { gc?: GcFn }).gc;

if (typeof gc !== "function") {
  throw new Error("Run with: deno run --v8-flags=--expose-gc bench/gc-allocations.bench.ts");
}

const forceGc: GcFn = gc;

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
  const before = Deno.memoryUsage();

  for (let i = 0; i < scenario.iterations; i++) {
    scenario.fn();
  }

  const beforeCollection = Deno.memoryUsage();
  collect();
  const afterCollection = Deno.memoryUsage();

  return {
    beforeGc: diff(beforeCollection, before),
    retainedAfterGc: diff(afterCollection, before),
  };
}

function warmupScenario(scenario: Scenario): void {
  const iterations = Math.min(scenario.iterations, scenario.warmupIterations ?? DEFAULT_WARMUP_ITERATIONS);
  for (let i = 0; i < iterations; i++) {
    scenario.fn();
  }
  collect();
}

function selectLowestAllocRound(rounds: RoundMeasurement[], key: keyof RoundMeasurement): MemorySnapshot {
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
  key: keyof RoundMeasurement,
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
  };
}

function checkBudgets(summaries: ScenarioSummary[]): boolean {
  let passed = true;
  console.log("\nAllocation budget check");

  for (const summary of summaries) {
    const budget = summary.scenario.maxSteadyStateBeforeGcBytesPerIter;
    if (budget === undefined) continue;

    const actual = bytesPerIteration(summary.highestSteadyStateBeforeGc, summary.scenario.iterations);
    const ok = actual <= budget;
    passed &&= ok;
    const status = ok ? "PASS" : "FAIL";
    console.log(
      `${status} ${summary.scenario.name}: highest steady-state before-GC ${
        actual.toFixed(4)
      } B/iter <= ${budget} B/iter`,
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
const movement = await populateMovementWorld(MEDIUM_CAPACITY);
const lifecycle = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const batchTagTransitions = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const batchDataTransitions = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const transitionTracking = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const wide = await populateWideWorld(SMALL_CAPACITY);
const movementQuery = createMovementQuery(mixed.components);
const renderableQuery = createRenderableQuery(mixed.components);
const movementFrameQuery = createMovementQuery(movement.components);
const renderableFrameQuery = createRenderableQuery(movement.components);
const batchTagPositionQuery = new Query({ all: [batchTagTransitions.components.position] });
const batchDataPositionQuery = new Query({ all: [batchDataTransitions.components.position] });
const transitionTrackingQuery = createMovementQuery(transitionTracking.components);
const wideQuery = createWideQuery(wide.components);
mixed.world.entities.query(movementQuery);
mixed.world.entities.query(renderableQuery);
movement.world.entities.query(movementFrameQuery);
movement.world.entities.query(renderableFrameQuery);
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
const positionData = { x: 0, y: 0 };
const mutationEntity = mixed.entities[128]!;
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
const fullSpawnEntities = new Array<Entity>(128);
let entitySink = 0;
let numericSink = 0;
let objectSink: unknown;

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

const scenarios: Scenario[] = [
  {
    name: "world constructor allocating",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: WORLD_CONSTRUCTOR_BUDGET_BYTES_PER_ITER,
    fn: () => {
      objectSink = new World({ capacity: 256, components: mixed.components.all });
    },
  },
  budgeted("entity create/destroy recycled hot path", 250_000, () => {
    const entity = mustCreateEntity(lifecycle.world);
    lifecycle.world.entities.destroy(entity);
    entitySink ^= entity;
  }),
  budgeted("isActive and entityHas hot checks", 250_000, () => {
    numericSink ^= mixed.world.entities.isActive(mutationEntity) ? 1 : 0;
    numericSink ^= mixed.world.components.entityHas(mixed.components.position, mutationEntity) ? 1 : 0;
  }),
  {
    name: "batch create/destroy 128 allocating control array reused",
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
    },
  },
  {
    name: "spawn/despawn 128 projectiles with 6 components",
    iterations: 10_000,
    maxSteadyStateBeforeGcBytesPerIter: PROJECTILE_SPAWN_DESPAWN_BUDGET_BYTES_PER_ITER,
    fn: () => {
      spawnProjectileBatch(fullSpawnEntities);
      destroyBatch(fullSpawnEntities);
      entitySink ^= fullSpawnEntities[0]!;
    },
  },
  budgeted("direct typed-array component writes", 250_000, () => {
    positionStorage.partitions.x[mutationEntity] = (positionStorage.partitions.x[mutationEntity] ?? 0) + 1;
    positionStorage.partitions.y[mutationEntity] = (positionStorage.partitions.y[mutationEntity] ?? 0) - 1;
  }),
  budgeted("proxy component writes with changed tracking", 250_000, () => {
    positionProxy.entity = mutationEntity;
    positionProxy.x = numericSink++;
    positionProxy.y = -numericSink;
  }),
  budgeted("setEntityData with reused data object", 250_000, () => {
    positionData.x = numericSink++;
    positionData.y = -numericSink;
    mixed.world.components.setEntityData(mixed.components.position, mutationEntity, positionData);
  }),
  {
    name: "getEntityData allocating object materialization",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: GET_ENTITY_DATA_BUDGET_BYTES_PER_ITER,
    fn: () => {
      objectSink = mixed.world.components.getEntityData(mixed.components.position, mutationEntity);
    },
  },
  {
    name: "cached query entity iteration",
    iterations: 100_000,
    maxSteadyStateBeforeGcBytesPerIter: QUERY_ITERATION_BUDGET_BYTES_PER_ITER,
    fn: () => {
      entitySink ^= countEntities(mixed.world.entities.query(movementQuery));
    },
  },
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
    name: "querySnapshot allocating convenience helper",
    iterations: 10_000,
    fn: () => {
      objectSink = mixed.world.entities.querySnapshot(movementQuery);
    },
  },
  {
    name: "snapshot helpers allocating convenience baseline",
    iterations: 5_000,
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
      lifecycle.world.components.addToEntity(lifecycle.components.velocity, transitionEntity, { x: 1, y: -1 });
      lifecycle.world.components.removeFromEntity(lifecycle.components.velocity, transitionEntity);
    },
  },
  {
    name: "bulk add/remove tag component across queryList - 896 entities",
    iterations: 10_000,
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
    iterations: 10_000,
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
      entitySink ^= countEntities(transitionTracking.world.archetypes.queryEntered(transitionTrackingQuery));
      transitionTracking.world.components.removeFromEntity(transitionTracking.components.velocity, enteredExitedEntity);
      entitySink ^= countEntities(transitionTracking.world.archetypes.queryExited(transitionTrackingQuery));
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
];

console.log("Miski ECS GC allocation pressure benchmark");
console.log("Measures memory growth during tight loops, forcing GC between each round.");

const summaries: ScenarioSummary[] = [];
for (const scenario of scenarios) {
  summaries.push(runScenario(scenario));
}

if (checkMode && !checkBudgets(summaries)) {
  Deno.exit(1);
}

if (entitySink === Number.MIN_SAFE_INTEGER || numericSink === Number.MIN_SAFE_INTEGER || objectSink === null) {
  console.log("unreachable", entitySink, numericSink, objectSink);
}
