/// <reference lib="deno.ns" />

import {
  asSlotIndex,
  captureWorldRollbackPoint,
  commitWorldRollbackPoint,
  entityIndex,
  Query,
  restoreWorldRollbackPoint,
  SpecError,
  World,
} from "../mod.ts";
import { createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";

Deno.test("archetype storage scales with population, not world capacity", async () => {
  const tags = Array.from({ length: 6 }, (_, i) => tagComponent(`tag${i}`));
  const world = new World({ capacity: 65536, components: tags });
  await world.init();
  const entity = world.entities.createOrThrow();

  const before = Deno.memoryUsage().external;
  // Visit all 64 tag subsets, registering one archetype per subset.
  for (let mask = 1; mask < 64; mask++) {
    for (let i = 0; i < tags.length; i++) if (mask & (1 << i)) world.components.addToEntity(tags[i]!, entity);
    for (let i = 0; i < tags.length; i++) world.components.removeFromEntity(tags[i]!, entity);
  }
  const grown = Deno.memoryUsage().external - before;

  // Capacity-sized per-archetype buffers cost ~1 MB each here (~64 MB total); population-sized ones are tiny.
  assert(grown < 8 * 1024 * 1024, `64 archetypes at capacity 65536 retained ${(grown / 1048576).toFixed(1)} MiB`);
  await world.destroy();
});

function medianMs(fn: () => void, runs = 15): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[runs >> 1]!;
}

type RollbackCost = { readonly commit: number; readonly restore: number };

async function rollbackCost(capacity: number): Promise<RollbackCost> {
  const position = vec2Component("position");
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], capacity);
  for (let i = 0; i < 1000; i++) {
    world.entities.createWithOrThrow([[position, { x: i, y: i }], [velocity, { x: 1, y: 1 }]]);
  }
  const commit = medianMs(() => commitWorldRollbackPoint(world, captureWorldRollbackPoint(world)));
  const restore = medianMs(() => restoreWorldRollbackPoint(world, captureWorldRollbackPoint(world)));
  await world.destroy();
  return { commit, restore };
}

Deno.test("rollback cost does not scale with world capacity", async () => {
  await rollbackCost(1024); // warm up
  const small = await rollbackCost(1024);
  const large = await rollbackCost(65536);
  // Same 1000 entities at 64x the capacity. Typed-array copies stay under ~0.6 ms here; the old
  // JSON/Array.from copies of every slot took ~7 ms to capture and ~15 ms to restore.
  for (const phase of ["commit", "restore"] as const) {
    assert(
      large[phase] < small[phase] * 10 + 1.5,
      `capture + ${phase} at 65536 took ${large[phase].toFixed(2)} ms vs ${small[phase].toFixed(2)} ms at 1024`,
    );
  }
});

Deno.test("rollback restore keeps query iteration order for reordered archetypes", async () => {
  const a = tagComponent("a");
  const world = await createTestWorld([a], 16);
  const entities = [0, 1, 2].map(() => world.entities.createWithOrThrow([[a]]));
  world.components.removeFromEntity(a, entities[0]!);
  world.components.addToEntity(a, entities[0]!);
  world.refresh();

  const query = new Query({ all: [a] });
  const order = (): number[] => {
    const list = world.entities.queryList(query);
    return Array.from({ length: list.count }, (_, i) => list.slots[i]!);
  };
  const before = order();
  restoreWorldRollbackPoint(world, captureWorldRollbackPoint(world));
  assertEquals(order(), before, "A no-op rollback must not reorder query iteration");
});

Deno.test("rollback restore keeps the entity allocation cursor", async () => {
  const control = await createTestWorld([tagComponent("a")], 16);
  const subject = await createTestWorld([tagComponent("a")], 16);
  for (const world of [control, subject]) {
    const entities = [0, 1, 2, 3, 4].map(() => world.entities.createOrThrow());
    world.entities.destroy(entities[1]!);
    world.entities.destroy(entities[3]!);
  }
  const point = captureWorldRollbackPoint(subject);
  subject.entities.createOrThrow();
  subject.entities.createOrThrow();
  restoreWorldRollbackPoint(subject, point);

  const next = (world: World): number[] => [0, 1, 2].map(() => entityIndex(world.entities.createOrThrow()));
  assertEquals(next(subject), next(control), "Rollback must restore the next slots handed out");
});

Deno.test("getActive rejects non-integer bounds with a library error and keeps capacity as an exclusive end", async () => {
  const world = await createTestWorld([tagComponent("a")], 8);
  for (let i = 0; i < 4; i++) world.entities.createOrThrow();
  assertThrows(() => world.entities.getActive(asSlotIndex(Number.NaN)), TypeError, "integer slot indices");
  assertThrows(() => world.entities.getActive(asSlotIndex(0), asSlotIndex(2.5)), TypeError, "integer slot indices");
  assertEquals(
    world.entities.getActiveSnapshot(asSlotIndex(1), asSlotIndex(world.entities.capacity)).map(entityIndex),
    [1, 2, 3],
    "end === capacity stays valid",
  );
});

Deno.test("Query.compose keeps an include entry's component in its filtering role from another input", () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const composed = Query.compose([new Query({ all: { a } }), new Query({ all: { b }, include: { a } })]);
  assertEquals(composed.all.map((component) => component.name), ["a", "b"], "all is unioned");
  assertEquals(composed.include.length, 0, "the redundant include entry is dropped");

  const anyComposed = Query.compose([
    new Query({ any: { a, b } }),
    new Query({ none: { c: tagComponent("c") }, include: { a } }),
  ]);
  assertEquals(anyComposed.include.length, 0, "an include entry covered by `any` is dropped");

  // A different key for the same component is still ambiguous for callbacks.
  assertThrows(
    () => Query.compose([new Query({ all: { a } }), new Query({ all: { b }, include: { other: a } })]),
    SpecError,
    "Query specification object is invalid",
  );
});
