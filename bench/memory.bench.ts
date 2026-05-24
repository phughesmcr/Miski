/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-console

import { Query, World } from "../mod.ts";
import {
  createBenchmarkComponents,
  createMovementQuery,
  createRenderableQuery,
  LARGE_CAPACITY,
  MEDIUM_CAPACITY,
  populateMixedWorld,
  populateMovementWorld,
  populateWideWorld,
  SMALL_CAPACITY,
} from "./fixtures.ts";

type GcFn = () => void;
type MemorySnapshot = ReturnType<typeof Deno.memoryUsage>;
type RetainedValue = unknown;

type MemoryScenario = {
  name: string;
  create: () => RetainedValue | Promise<RetainedValue>;
  maxRetainedBytes?: number;
};

type MemorySummary = {
  scenario: MemoryScenario;
  retained: MemorySnapshot;
};

const checkMode = Deno.args.includes("--check");
const gc = (globalThis as { gc?: GcFn }).gc;

if (typeof gc !== "function") {
  throw new Error("Run with: deno run --v8-flags=--expose-gc bench/memory.bench.ts");
}

const forceGc: GcFn = gc;
const retainedValues: RetainedValue[] = [];

function collect(): void {
  for (let i = 0; i < 3; i++) {
    forceGc();
  }
}

function diff(after: MemorySnapshot, before: MemorySnapshot): MemorySnapshot {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
  };
}

function totalBytes(snapshot: MemorySnapshot): number {
  return snapshot.heapUsed + snapshot.external;
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MiB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(2)} KiB`;
  return `${sign}${abs} B`;
}

function printRow(label: string, retained: MemorySnapshot): void {
  console.log(
    [
      label.padEnd(46),
      `total=${formatBytes(totalBytes(retained))}`.padStart(20),
      `heap=${formatBytes(retained.heapUsed)}`.padStart(18),
      `external=${formatBytes(retained.external)}`.padStart(22),
      `rss=${formatBytes(retained.rss)}`.padStart(18),
    ].join("  "),
  );
}

async function measureScenario(scenario: MemoryScenario): Promise<MemorySummary> {
  collect();
  const before = Deno.memoryUsage();
  const value = await scenario.create();
  retainedValues.push(value);
  collect();
  const after = Deno.memoryUsage();
  const retained = diff(after, before);
  printRow(scenario.name, retained);
  return { scenario, retained };
}

function checkBudgets(summaries: MemorySummary[]): boolean {
  let passed = true;
  console.log("\nRetained memory budget check");

  for (const summary of summaries) {
    const budget = summary.scenario.maxRetainedBytes;
    if (budget === undefined) continue;

    const actual = totalBytes(summary.retained);
    const ok = actual <= budget;
    passed &&= ok;
    const status = ok ? "PASS" : "FAIL";
    console.log(
      `${status} ${summary.scenario.name}: retained ${formatBytes(actual)} <= ${formatBytes(budget)}`,
    );
  }

  return passed;
}

function worldScenario(capacity: number): MemoryScenario["create"] {
  return async () => {
    const components = createBenchmarkComponents();
    const world = new World({ capacity, components: components.all });
    await world.init();
    return { components, world };
  };
}

const scenarios: MemoryScenario[] = [
  {
    name: "World init - 1K capacity / 12 components",
    maxRetainedBytes: 1_500 * 1024,
    create: worldScenario(SMALL_CAPACITY),
  },
  {
    name: "World init - 8K capacity / 12 components",
    maxRetainedBytes: 4 * 1024 * 1024,
    create: worldScenario(MEDIUM_CAPACITY),
  },
  {
    name: "World init - 32K capacity / 12 components",
    maxRetainedBytes: 12 * 1024 * 1024,
    create: worldScenario(LARGE_CAPACITY),
  },
  {
    name: "Populated mixed world - 8K gameplay distribution",
    maxRetainedBytes: 8 * 1024 * 1024,
    create: () => populateMixedWorld(MEDIUM_CAPACITY),
  },
  {
    name: "Movement system world - 32K position/velocity",
    maxRetainedBytes: 14 * 1024 * 1024,
    create: () => populateMovementWorld(LARGE_CAPACITY),
  },
  {
    name: "Wide registry world - 1K capacity / 64 tags",
    maxRetainedBytes: 4 * 1024 * 1024,
    create: () => populateWideWorld(SMALL_CAPACITY),
  },
  {
    name: "Cached query results - 8K mixed world",
    maxRetainedBytes: 8 * 1024 * 1024,
    create: async () => {
      const fixture = await populateMixedWorld(MEDIUM_CAPACITY);
      const movementQuery = createMovementQuery(fixture.components);
      const renderableQuery = createRenderableQuery(fixture.components);
      const positionQuery = new Query({ all: [fixture.components.position] });
      fixture.world.entities.queryList(movementQuery);
      fixture.world.entities.queryList(renderableQuery);
      fixture.world.entities.queryList(positionQuery);
      return { fixture, movementQuery, positionQuery, renderableQuery };
    },
  },
  {
    name: "Snapshot convenience arrays - 8K mixed world",
    maxRetainedBytes: 8 * 1024 * 1024,
    create: async () => {
      const fixture = await populateMixedWorld(MEDIUM_CAPACITY);
      const movementQuery = createMovementQuery(fixture.components);
      return {
        fixture,
        active: fixture.world.entities.getActiveSnapshot(),
        changed: fixture.world.components.getChangedSnapshot(fixture.components.position),
        owners: fixture.world.components.getOwnersSnapshot(fixture.components.position),
        query: fixture.world.entities.querySnapshot(movementQuery),
      };
    },
  },
];

console.log("Miski ECS retained memory benchmark");
console.log("Measures retained heap + external ArrayBuffer memory after forced GC.\n");

const summaries: MemorySummary[] = [];
for (const scenario of scenarios) {
  summaries.push(await measureScenario(scenario));
}

if (checkMode && !checkBudgets(summaries)) {
  Deno.exit(1);
}

if (retainedValues.length === Number.MIN_SAFE_INTEGER) {
  console.log("unreachable", retainedValues.length);
}
