/// <reference lib="deno.ns" />

import { asSlotIndex, type Entity, Query, type World } from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals } from "./helpers.ts";

function sorted(values: Iterable<number>): number[] {
  return [...values].toSorted((a, b) => a - b);
}

async function worldWith(count: number): Promise<{ world: World; query: Query; other: Query; entities: Entity[] }> {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag], 64);
  const query = new Query({ all: [position] });
  const other = new Query({ all: [tag] });
  const entities: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity);
    if (i % 2 === 0) world.components.addToEntity(tag, entity);
    entities.push(entity);
  }
  world.refresh();
  return { world, query, other, entities };
}

Deno.test("nested query() loops over the same query each get their own cursor", async () => {
  const { world, query, entities } = await worldWith(4);
  const pairs: string[] = [];
  for (const a of world.entities.query(query)) {
    for (const b of world.entities.query(query)) pairs.push(`${a}:${b}`);
  }
  assertStrictEquals(pairs.length, 16, "4 x 4 nested loop yields every pair");
  assertStrictEquals(new Set(pairs).size, 16, "No pair repeats");

  let triples = 0;
  for (const _a of world.entities.query(query)) {
    for (const _b of world.entities.query(query)) {
      for (const _c of world.entities.query(query)) triples++;
    }
  }
  assertStrictEquals(triples, 64, "Depth-3 nesting is complete");

  const outer: number[] = [];
  for (const a of world.entities.query(query)) {
    outer.push(a);
    for (const _b of world.entities.query(query)) break;
  }
  assertEquals(sorted(outer), sorted(entities), "An inner break leaves the outer loop intact");
  await world.destroy();
});

Deno.test("nested query() loops over different queries stay independent", async () => {
  const { world, query, other, entities } = await worldWith(4);
  let pairs = 0;
  const seen: number[] = [];
  for (const a of world.entities.query(query)) {
    seen.push(a);
    for (const _b of world.entities.query(other)) pairs++;
  }
  assertEquals(sorted(seen), sorted(entities), "Outer loop sees every member");
  assertStrictEquals(pairs, 8, "Inner loop over the 2 tagged entities runs for each of 4");
  await world.destroy();
});

Deno.test("query() iterators are reused once finished and stay done after exhaustion", async () => {
  const { world, query, entities } = await worldWith(3);
  const first = world.entities.query(query);
  assertEquals(sorted(first), sorted(entities), "Full pass");
  assert(first.next().done === true, "Exhausted iterator reports done");
  const second = world.entities.query(query);
  assertStrictEquals(second, first, "A finished iterator returns to the pool");
  const third = world.entities.query(query);
  assert(third !== second, "An iterator in use is not handed out again");
  assertEquals(sorted(second), sorted(entities), "Reused iterator restarts");
  assertEquals(sorted(third), sorted(entities), "Concurrent iterator is complete");
  await world.destroy();
});

Deno.test("nested getActive() loops each get their own cursor and buffer", async () => {
  const { world, entities } = await worldWith(4);
  let pairs = 0;
  for (const _a of world.entities.getActive()) {
    for (const _b of world.entities.getActive()) pairs++;
  }
  assertStrictEquals(pairs, 16, "4 x 4 nested getActive yields every pair");

  // A nested call with different bounds must not overwrite the outer snapshot.
  const outer: number[] = [];
  let inner = 0;
  for (const a of world.entities.getActive()) {
    outer.push(a);
    for (const _b of world.entities.getActive(asSlotIndex(0), asSlotIndex(1))) inner++;
  }
  assertEquals(sorted(outer), sorted(entities), "Outer full-range loop survives a narrower nested call");
  assertStrictEquals(inner, 4, "Inner single-slot range yields one entity per outer step");
  await world.destroy();
});

Deno.test("destroying each entity while iterating query() visits every entity once", async () => {
  const { world, query, entities } = await worldWith(4);
  const visited: number[] = [];
  for (const entity of world.entities.query(query)) {
    visited.push(entity);
    world.entities.destroy(entity);
  }
  assertEquals(sorted(visited), sorted(entities), "Every entity visited once");
  assertStrictEquals(world.entities.getActiveCount(), 0, "Every entity destroyed");
  await world.destroy();
});

Deno.test("destroying each entity while iterating queryList() visits every entity once", async () => {
  const { world, query, entities } = await worldWith(4);
  const list = world.entities.queryList(query);
  const visited: number[] = [];
  for (let i = 0; i < list.count; i++) {
    const entity = list.entities[i]!;
    visited.push(entity);
    world.entities.destroy(entity);
  }
  assertEquals(sorted(visited), sorted(entities), "Every entity visited once");
  assertStrictEquals(world.entities.getActiveCount(), 0, "Every entity destroyed");
  await world.destroy();
});

Deno.test("removing the queried component while iterating query() visits every entity once", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 16);
  const query = new Query({ all: [position] });
  const entities: Entity[] = [];
  for (let i = 0; i < 4; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity);
    entities.push(entity);
  }
  const visited: number[] = [];
  for (const entity of world.entities.query(query)) {
    visited.push(entity);
    world.components.removeFromEntity(position, entity);
  }
  assertEquals(sorted(visited), sorted(entities), "Every entity visited once");
  assertEquals([...world.entities.query(query)], [], "No members remain");
  await world.destroy();
});

Deno.test("destroying each entity while iterating getActive() visits every entity once", async () => {
  const { world, entities } = await worldWith(4);
  const visited: number[] = [];
  for (const entity of world.entities.getActive()) {
    visited.push(entity);
    world.entities.destroy(entity);
  }
  assertEquals(sorted(visited), sorted(entities), "Every entity visited once");
  await world.destroy();
});
