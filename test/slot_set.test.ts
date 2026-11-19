/// <reference lib="deno.ns" />

import { packEntity } from "../src/entity/entity.ts";
import { SlotSet } from "../src/component/slot-set.ts";
import { assert, assertEquals } from "./helpers.ts";

const members = (set: SlotSet): number[] => Array.from(set.list.subarray(0, set.count));

Deno.test("SlotSet allocates lazily, grows by doubling and stops at its maximum length", () => {
  const set = new SlotSet(1000, 40, (slot) => packEntity(slot, 0));
  assertEquals(set.list.length, 0, "Nothing is allocated before the first add");
  assertEquals(set.positions.length, 0, "Positions are allocated with the first reservation");
  assert(!set.has(3), "An empty set has no members");
  for (let slot = 0; slot < 40; slot++) set.add(slot * 7);
  assertEquals(set.count, 40, "Every add is kept");
  assertEquals(set.list.length, 40, "Growth (16, 32, ...) is capped at the maximum length");
  assertEquals(set.positions.length, 1000, "Positions cover every slot");
  for (let slot = 0; slot < 40; slot++) assert(set.has(slot * 7), "Members survive growth");
  assert(!set.has(1), "A non-member is not found");
});

Deno.test("SlotSet swap-removes, clears and assigns without stale members", () => {
  const set = new SlotSet(64, 64, (slot) => packEntity(slot, 0));
  for (const slot of [5, 9, 2, 40]) set.add(slot);
  set.remove(9);
  assertEquals(members(set), [5, 40, 2], "The last member moves into the removed one's place");
  assert(!set.has(9) && set.has(40), "Membership follows the swap");
  set.remove(2);
  assertEquals(members(set), [5, 40], "Removing the last member just shrinks the count");
  set.clear();
  assert(!set.has(5) && !set.has(40), "Clear drops every member though the lists keep stale entries");
  set.add(40);
  assert(set.has(40) && !set.has(5), "A stale position cannot resurrect a cleared member");
  set.assign([7, 3, 11]);
  assertEquals(members(set), [7, 3, 11], "Assign replaces the members in order");
  assert(set.has(3) && !set.has(40), "Assign rebuilds the positions");
  assertEquals(
    Array.from(set.iterator.reset(set.count)),
    [7, 3, 11].map((slot) => packEntity(slot, 0)),
    "The iterator packs the members",
  );
  set.assign([]);
  assertEquals(set.count, 0, "Assigning nothing empties the set");
});
