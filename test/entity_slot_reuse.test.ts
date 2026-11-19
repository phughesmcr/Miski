/// <reference lib="deno.ns" />

import { type Entity, entityGeneration, entityIndex, packEntity } from "../mod.ts";
import { EntityManager } from "../src/entity/entity-manager.ts";
import { createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals } from "./helpers.ts";

/** Number of distinct generations a handle can encode (15 bits). */
const GENERATIONS = 1 << 15;

Deno.test("freed slots are reissued next-fit, after the allocator sweeps past the other free slots", () => {
  const manager = new EntityManager(8);
  const entities = Array.from({ length: 6 }, () => manager.create()!);
  manager.destroy(entities[1]!);
  manager.destroy(entities[4]!);
  const next = Array.from({ length: 5 }, () => manager.create());
  assertEquals(next.slice(0, 4).map((e) => entityIndex(e!)), [6, 7, 1, 4], "Untouched slots first, then wrap");
  assertStrictEquals(next[4], undefined, "The pool is full");
});

Deno.test("create-then-destroy churn rotates slots instead of reusing the last freed one", async () => {
  const world = await createTestWorld([tagComponent("a")], 64);
  world.entities.createOrThrow();
  const seen = new Set<number>();
  for (let i = 0; i < 63; i++) {
    const entity = world.entities.createOrThrow();
    seen.add(entityIndex(entity));
    world.entities.destroy(entity);
  }
  assertStrictEquals(seen.size, 63, "Each spawn in one sweep takes a different free slot");
  await world.destroy();
});

Deno.test("a held stale handle is not reissued by heavy create-then-destroy churn", async () => {
  // LIFO reuse wrapped the 15-bit generation after 32,767 spawns here and revived the stale handle.
  const world = await createTestWorld([tagComponent("a")], 64);
  world.entities.createOrThrow();
  const stale = world.entities.createOrThrow();
  world.entities.destroy(stale);
  for (let i = 0; i < GENERATIONS * 3; i++) {
    const entity = world.entities.createOrThrow();
    if (entity === stale) throw new Error(`Stale handle reissued after ${i + 1} spawns`);
    world.entities.destroy(entity);
  }
  assert(!world.entities.isActive(stale), "The stale handle stays inactive");
  await world.destroy();
});

Deno.test("generations still wrap when a slot is the only free one (documented limit)", () => {
  const manager = new EntityManager(8);
  const entities = Array.from({ length: 8 }, () => manager.create()!);
  const stale = entities[3]!;
  manager.destroy(stale);
  let reissued: Entity | undefined;
  for (let i = 1; i < GENERATIONS; i++) {
    const entity = manager.create()!;
    assertStrictEquals(entityIndex(entity), 3, "The only free slot is reused");
    manager.destroy(entity);
    if (i === GENERATIONS - 1) reissued = manager.create();
  }
  assertStrictEquals(entityGeneration(reissued!), entityGeneration(stale), "The 15-bit generation wrapped");
  assertStrictEquals(reissued, stale, "With one free slot, the handle repeats after 32,768 creations");
});

Deno.test("generational handles invalidate after destroy and reuse", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const first = world.entities.createOrThrow();
  assertStrictEquals(entityIndex(first), 0, "first entity uses slot 0");
  assertStrictEquals(entityGeneration(first), 0, "first entity starts at generation 0");

  world.entities.destroy(first);
  for (let slot = 1; slot < 8; slot++) {
    assertStrictEquals(entityIndex(world.entities.createOrThrow()), slot, "next-fit issues untouched slots first");
  }
  const recycled = world.entities.createOrThrow();
  assertStrictEquals(entityIndex(recycled), 0, "slot 0 is reused once the allocator wraps");
  assertStrictEquals(entityGeneration(recycled), 1, "generation bumps on reuse");
  assert(!world.entities.isActive(first), "stale handle must not be active");
  assert(world.entities.isActive(recycled), "new generation handle must be active");
  assertStrictEquals(packEntity(0, 1), recycled, "packed handle matches recycled entity");
});
