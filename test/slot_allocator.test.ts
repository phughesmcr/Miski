/// <reference lib="deno.ns" />

import { SlotAllocator } from "../src/entity/slot-allocator.ts";
import { assert, assertEquals, assertStrictEquals } from "./helpers.ts";

function acquireAll(allocator: SlotAllocator, count: number): number[] {
  return Array.from({ length: count }, () => allocator.acquire());
}

Deno.test("SlotAllocator hands out slots in order and returns -1 when full", () => {
  const allocator = new SlotAllocator(5);
  assertStrictEquals(allocator.size, 5, "size");
  assertStrictEquals(allocator.occupiedCount, 0, "starts empty");
  assertEquals(acquireAll(allocator, 5), [0, 1, 2, 3, 4], "fresh slots in ascending order");
  assertStrictEquals(allocator.occupiedCount, 5, "every slot occupied");
  assertStrictEquals(allocator.cursor, 0, "the cursor wraps after the last slot");
  assertStrictEquals(allocator.acquire(), -1, "a full allocator returns -1");
  assertStrictEquals(allocator.occupiedCount, 5, "a failed acquire changes nothing");
});

Deno.test("SlotAllocator is next-fit: a freed slot is reissued only once the cursor sweeps back to it", () => {
  const allocator = new SlotAllocator(4);
  acquireAll(allocator, 3);
  allocator.release(0);
  assertStrictEquals(allocator.cursor, 3, "release leaves the cursor alone");
  assertStrictEquals(allocator.acquire(), 3, "the untouched slot after the cursor comes first");
  assertStrictEquals(allocator.acquire(), 0, "then the search wraps to the freed slot");
  assertStrictEquals(allocator.cursor, 1, "the cursor moves past the slot it issued");

  allocator.release(2);
  allocator.release(1);
  assertStrictEquals(allocator.acquire(), 1, "the first free slot at or after the cursor");
  assertStrictEquals(allocator.acquire(), 2, "then the next one");
  assertStrictEquals(allocator.acquire(), -1, "full again");
});

Deno.test("SlotAllocator spreads create-then-destroy churn over every free slot", () => {
  const allocator = new SlotAllocator(8);
  const issued: number[] = [];
  for (let i = 0; i < 16; i++) {
    const slot = allocator.acquire();
    issued.push(slot);
    allocator.release(slot);
  }
  assertEquals(issued, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7], "churn rotates instead of reusing one slot");
  assertStrictEquals(allocator.occupiedCount, 0, "every slot released");
});

Deno.test("SlotAllocator release of a free slot is a no-op", () => {
  const allocator = new SlotAllocator(4);
  allocator.acquire();
  allocator.release(2);
  assertStrictEquals(allocator.occupiedCount, 1, "releasing a free slot does not change the count");
  allocator.release(0);
  allocator.release(0);
  assertStrictEquals(allocator.occupiedCount, 0, "a double release counts once");
  assert(!allocator.isOccupied(0), "slot 0 is free");
});

Deno.test("SlotAllocator reports occupied slots within clamped bounds", () => {
  const allocator = new SlotAllocator(40);
  acquireAll(allocator, 40);
  for (const slot of [0, 3, 31, 32, 39]) allocator.release(slot);
  const out = new Uint32Array(40);
  const count = allocator.occupiedIndicesInto(out);
  assertStrictEquals(count, 35, "every occupied slot by default");
  assert(!Array.from(out.subarray(0, count)).some((slot) => [0, 3, 31, 32, 39].includes(slot)), "free slots skipped");
  assertEquals(Array.from(out.subarray(0, allocator.occupiedIndicesInto(out, 29, 35))), [29, 30, 33, 34], "a range");
  assertEquals(
    Array.from(out.subarray(0, allocator.occupiedIndicesInto(out, -5, 100))).length,
    35,
    "bounds are clamped to the allocator",
  );
  assertStrictEquals(allocator.occupiedIndicesInto(out, 10, 10), 0, "an empty range writes nothing");
  assertStrictEquals(allocator.occupiedIndicesInto(out, 20, 10), 0, "a reversed range writes nothing");
  assert(allocator.isOccupied(1) && !allocator.isOccupied(31), "isOccupied reads the bitmap");
});

Deno.test("SlotAllocator words are live and toUint32Array is a copy", () => {
  const allocator = new SlotAllocator(33);
  const copy = allocator.toUint32Array();
  const live = allocator.words;
  allocator.acquire();
  assertStrictEquals(live[0], 1, "the live view sees the acquisition");
  assertStrictEquals(copy[0], 0, "the copy does not");
  assertStrictEquals(copy.length, 2, "33 slots need two words");
});

Deno.test("SlotAllocator restore replays allocation order from occupancy and cursor", () => {
  const source = new SlotAllocator(10);
  acquireAll(source, 7);
  for (const slot of [1, 4, 5]) source.release(slot);
  const occupancy = source.toUint32Array();
  const cursor = source.cursor;
  const expected = acquireAll(source, 6);

  const replay = new SlotAllocator(10);
  acquireAll(replay, 2);
  replay.restore(occupancy, cursor);
  assertStrictEquals(replay.occupiedCount, 4, "the count is recomputed from the bitmap");
  assertStrictEquals(replay.cursor, cursor, "the cursor is restored");
  assertEquals(acquireAll(replay, 6), expected, "the same slots are issued in the same order");
});

Deno.test("SlotAllocator restore masks bits past the size and resets an invalid cursor to 0", () => {
  const allocator = new SlotAllocator(40);
  allocator.restore([0xffffffff, 0xffffffff], 5);
  assertStrictEquals(allocator.occupiedCount, 40, "bits past slot 39 are dropped");
  assertStrictEquals(allocator.acquire(), -1, "full");

  for (const cursor of [-1, 40, 1.5, Number.NaN]) {
    allocator.restore([0b10], cursor);
    assertStrictEquals(allocator.cursor, 0, `cursor ${cursor} restarts at slot 0`);
    assertStrictEquals(allocator.occupiedCount, 1, "missing words read as empty");
    assertStrictEquals(allocator.acquire(), 0, "the search starts at slot 0");
  }
});
