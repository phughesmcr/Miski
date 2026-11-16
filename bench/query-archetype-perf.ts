/// <reference lib="deno.ns" />
/**
 * Probes for the query/archetype performance findings.
 *
 * Run with:
 *   deno run --v8-flags=--expose-gc,--max-semi-space-size=256,--min-semi-space-size=256 bench/query-archetype-perf.ts
 *
 * The large fixed semi-space keeps scavenges out of the allocation windows, so `heapUsed` deltas count every
 * young-generation byte allocated by the measured loop.
 */
import { Component, Query, World } from "../mod.ts";
import type { Entity } from "../mod.ts";

type GcFn = () => void;
const gc = (globalThis as { gc?: GcFn }).gc;
if (typeof gc !== "function") {
  throw new Error(
    "Run with: deno run --v8-flags=--expose-gc,--max-semi-space-size=256,--min-semi-space-size=256 bench/query-archetype-perf.ts",
  );
}
const forceGc: GcFn = gc;

function collect(): void {
  for (let i = 0; i < 3; i++) forceGc();
}

function allocatedBytes(fn: () => void): number {
  collect();
  const before = Deno.memoryUsage();
  fn();
  const after = Deno.memoryUsage();
  return (after.heapUsed - before.heapUsed) + (after.external - before.external);
}

function tags(prefix: string, count: number): Component<null>[] {
  const result = new Array<Component<null>>(count);
  for (let i = 0; i < count; i++) result[i] = new Component<null>({ name: `${prefix}${i}` });
  return result;
}

function mustCreate(world: World): Entity {
  const entity = world.entities.create();
  if (entity === undefined) throw new Error("capacity exhausted");
  return entity;
}

let sink = 0;

function countIterable(iterable: Iterable<Entity>): number {
  let count = 0;
  for (const _entity of iterable) count++;
  return count;
}

/** Finding 1: an unrelated structural change must not rebuild every query result. */
async function probeInvalidation(): Promise<void> {
  const groups = tags("group", 8);
  const unrelated = new Component<null>({ name: "unrelated" });
  const world = new World({ capacity: 32_768, components: [...groups, unrelated] });
  await world.init();
  for (let i = 0; i < 30_000; i++) world.components.addToEntity(groups[i % 8]!, mustCreate(world));
  const queries = groups.map((group) => new Query({ all: [group] }));
  world.refresh();

  const read = () => {
    for (let q = 0; q < queries.length; q++) sink ^= world.entities.queryList(queries[q]!).count;
  };
  const churn = () => {
    const entity = mustCreate(world);
    world.components.addToEntity(unrelated, entity);
    world.entities.destroy(entity);
  };
  const time = (label: string, frame: () => void): void => {
    for (let i = 0; i < 500; i++) frame();
    const frames = 5_000;
    const start = performance.now();
    for (let i = 0; i < frames; i++) frame();
    const us = ((performance.now() - start) * 1000) / frames;
    console.log(`  ${label.padEnd(44)} ${us.toFixed(2).padStart(9)} us/frame`);
  };

  console.log("\n[1] 30k entities, 8 single-component queries");
  time("read 8 queries, no change", () => {
    read();
    world.refresh();
  });
  time("unrelated spawn/tag/destroy, no reads (control)", () => {
    churn();
    world.refresh();
  });
  time("unrelated spawn/tag/destroy + read 8 queries", () => {
    churn();
    read();
    world.refresh();
  });
  time("related add/remove on group0 + read 8 queries", () => {
    const entity = mustCreate(world);
    world.components.addToEntity(groups[0]!, entity);
    world.entities.destroy(entity);
    read();
    world.refresh();
  });
  await world.destroy();
}

/** Finding 2: query result buffers must not be sized by world capacity. */
async function probeResultBuffers(): Promise<void> {
  const count = 64;
  const components = tags("single", count);
  const world = new World({ capacity: 65_536, components });
  await world.init();
  for (let i = 0; i < count; i++) world.components.addToEntity(components[i]!, mustCreate(world));
  world.refresh();
  const queries = components.map((component) => new Query({ all: [component] }));
  // Register first so only the result buffers are measured.
  for (const query of queries) world.archetypes.queryComponents(query);
  const bytes = allocatedBytes(() => {
    for (const query of queries) sink ^= world.entities.queryList(query).count;
  });
  console.log("\n[2] capacity 65536, 64 queries with 1 match each");
  console.log(`  first queryList per query ${(bytes / count / 1024).toFixed(2).padStart(28)} KiB/query`);
  await world.destroy();
}

/** Finding 3: archetype query iterators must not allocate per entity or per call. */
async function probeIterators(): Promise<void> {
  const groups = tags("iter", 4);
  const mover = new Component<null>({ name: "mover" });
  const world = new World({ capacity: 32_768, components: [...groups, mover] });
  await world.init();
  for (let i = 0; i < 30_000; i++) {
    const entity = mustCreate(world);
    world.components.addToEntity(groups[0]!, entity);
    if (i % 2 === 0) world.components.addToEntity(groups[1]!, entity);
    if (i % 3 === 0) world.components.addToEntity(groups[2]!, entity);
  }
  const all = new Query({ all: [groups[0]!] });
  const moving = new Query({ all: [mover] });
  const moved = mustCreate(world);
  world.refresh();

  const passes = 20;
  for (let i = 0; i < 5; i++) sink ^= countIterable(world.archetypes.queryEntities(all));
  const passBytes = allocatedBytes(() => {
    for (let i = 0; i < passes; i++) sink ^= countIterable(world.archetypes.queryEntities(all));
  });

  const calls = 20_000;
  const transition = () => {
    world.components.addToEntity(mover, moved);
    sink ^= countIterable(world.archetypes.queryEntered(moving));
    world.components.removeFromEntity(mover, moved);
    sink ^= countIterable(world.archetypes.queryExited(moving));
    world.refresh();
  };
  const transitionOnly = () => {
    world.components.addToEntity(mover, moved);
    world.components.removeFromEntity(mover, moved);
    world.refresh();
  };
  for (let i = 0; i < 2_000; i++) {
    transition();
    transitionOnly();
  }
  const withViews = allocatedBytes(() => {
    for (let i = 0; i < calls; i++) transition();
  });
  const withoutViews = allocatedBytes(() => {
    for (let i = 0; i < calls; i++) transitionOnly();
  });

  console.log("\n[3] archetype iterators");
  console.log(`  queryEntities 30k-entity pass ${(passBytes / passes / 1024).toFixed(2).padStart(24)} KiB/pass`);
  console.log(
    `  queryEntered + queryExited ${((withViews - withoutViews) / calls / 2).toFixed(1).padStart(27)} B/call`,
  );
  await world.destroy();
}

/** Finding 4: batch moves must group by source archetype in O(entities). */
async function probeBatchMove(sourceArchetypes: number): Promise<void> {
  const bits = Math.log2(sourceArchetypes);
  const spread = tags("spread", bits);
  const base = new Component<null>({ name: "base" });
  const target = new Component<null>({ name: "target" });
  const world = new World({ capacity: 32_768, components: [base, target, ...spread] });
  await world.init();
  for (let i = 0; i < 32_000; i++) {
    const entity = mustCreate(world);
    world.components.addToEntity(base, entity);
    const mask = i % sourceArchetypes;
    for (let b = 0; b < bits; b++) if (mask & (1 << b)) world.components.addToEntity(spread[b]!, entity);
  }
  const everyone = new Query({ all: [base] });
  world.refresh();

  let addMs = 0;
  const rounds = 40;
  for (let r = 0; r < rounds + 5; r++) {
    const start = performance.now();
    world.components.addToEntities(target, world.entities.queryList(everyone));
    const elapsed = performance.now() - start;
    if (r >= 5) addMs += elapsed;
    world.components.removeFromEntities(target, world.entities.queryList(everyone));
    world.refresh();
  }
  console.log(
    `  ${`32k batch add, ${sourceArchetypes} source archetypes`.padStart(44)} ${
      (addMs / rounds).toFixed(2).padStart(9)
    } ms`,
  );
  await world.destroy();
}

await probeInvalidation();
await probeResultBuffers();
await probeIterators();
console.log("\n[4] batch move grouping");
await probeBatchMove(2);
await probeBatchMove(512);
if (sink === 0.5) console.log(sink);
