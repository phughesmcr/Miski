/// <reference lib="deno.ns" />

import { RelationList } from "../src/relation/relation-list.ts";
import { assert, assertEquals, assertStrictEquals } from "./helpers.ts";

/** The first `count` values of a borrowed index view. */
function prefix(view: { readonly [index: number]: number }, count: number): number[] {
  return Array.from({ length: count }, (_, i) => view[i]!);
}

/** Push `count` entries whose entity, slot, row and depth are derived from their index. */
function fill(list: RelationList, count: number): void {
  for (let i = 0; i < count; i++) list.push(1000 + i, i, i * 2 - 1, i % 3);
}

Deno.test("RelationList keeps entities, slots, rows and depths parallel", () => {
  const list = new RelationList(64, true);
  assertStrictEquals(list.count, 0, "starts empty");
  fill(list, 5);
  assertStrictEquals(list.count, 5, "count");
  assertEquals(prefix(list.entities, 5), [1000, 1001, 1002, 1003, 1004], "entities");
  assertEquals(prefix(list.slots, 5), [0, 1, 2, 3, 4], "slots");
  assertEquals(Array.from(list.rows.subarray(0, 5)), [-1, 1, 3, 5, 7], "rows, including -1 for a root");
  assertEquals(Array.from(list.depths.subarray(0, 5)), [0, 1, 2, 0, 1], "depths");
  assertStrictEquals(list.slotAt(3), 3, "slotAt");
});

Deno.test("RelationList grows by doubling up to its capacity and keeps every entry", () => {
  const list = new RelationList(40, true);
  const before = list.entities;
  assertStrictEquals(list.rows.length, 16, "starts at 16 entries");
  fill(list, 40);
  assert(list.entities !== before, "growth re-points the public buffers");
  assertStrictEquals(list.rows.length, 40, "doubling stops at the capacity");
  assertStrictEquals(list.depths.length, 40, "depths grow with entities");
  for (let i = 0; i < 40; i++) {
    assertStrictEquals(list.entities[i], 1000 + i, `entity ${i} survived growth`);
    assertStrictEquals(list.slots[i], i, `slot ${i} survived growth`);
    assertStrictEquals(list.rows[i], i * 2 - 1, `row ${i} survived growth`);
    assertStrictEquals(list.depths[i], i % 3, `depth ${i} survived growth`);
  }
  assertStrictEquals(new RelationList(4, false).rows.length, 4, "a small world starts at its capacity");
});

Deno.test("RelationList without depths keeps an empty depth buffer", () => {
  const list = new RelationList(64, false);
  fill(list, 20);
  assertStrictEquals(list.depths.length, 0, "no depth storage, even after growth");
  assertStrictEquals(list.count, 20, "entries still pushed");
});

Deno.test("RelationList slot storage is wide enough for the world capacity", () => {
  const small = new RelationList(256, false);
  small.push(1, 255, 0, 0);
  assertStrictEquals(small.slotAt(0), 255, "8-bit slots up to 255");
  const large = new RelationList(1024, false);
  large.push(1, 1023, 0, 0);
  assertStrictEquals(large.slotAt(0), 1023, "16-bit slots above 256");
});

Deno.test("RelationList clear resets the count and later pushes overwrite", () => {
  const list = new RelationList(64, false);
  fill(list, 3);
  assertStrictEquals(list.clear(), list, "clear returns the list");
  assertStrictEquals(list.count, 0, "cleared");
  list.push(7, 9, 11, 0);
  assertEquals([...list], [7], "only the new entry is listed");
  assertStrictEquals(list.rows[0], 11, "the new row overwrote the old one");
});

Deno.test("RelationList iterate() is reusable and follows growth", () => {
  const list = new RelationList(64, false);
  fill(list, 3);
  const iterator = list.iterate();
  assertEquals([...iterator], [1000, 1001, 1002], "iterates the valid handles");
  fill(list, 30);
  assertStrictEquals(list.iterate(), iterator, "the same iterator object every call");
  assertStrictEquals([...list.iterate()].length, 33, "the iterator sees entries pushed after growth");
  assertStrictEquals([...list.iterate()][32], 1029, "and reads them from the grown buffer");
});

Deno.test("RelationList each() walks slot, handle and index in order", () => {
  const list = new RelationList(64, false);
  fill(list, 4);
  const seen: [number, number, number][] = [];
  list.each((slot, entity, index) => seen.push([slot, entity, index]));
  assertEquals(seen, [[0, 1000, 0], [1, 1001, 1], [2, 1002, 2], [3, 1003, 3]], "dual walk");
});

Deno.test("RelationList spread iteration is safe to nest", () => {
  const list = new RelationList(64, false);
  fill(list, 3);
  const pairs: string[] = [];
  for (const outer of list) for (const inner of list) pairs.push(`${outer - 1000}${inner - 1000}`);
  assertEquals(pairs, ["00", "01", "02", "10", "11", "12", "20", "21", "22"], "independent iterators");
});
