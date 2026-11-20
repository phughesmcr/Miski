/// <reference lib="deno.ns" />

import { type Entity, packEntity } from "../mod.ts";
import type { Archetype } from "../src/archetype/archetype.ts";
import { TransitionWindow } from "../src/archetype/transition-window.ts";
import { assertEquals, assertStrictEquals } from "./helpers.ts";

/** Stand-in archetypes: the window only stores and returns them by reference. */
const A = { name: "A" } as unknown as Archetype;
const B = { name: "B" } as unknown as Archetype;
const C = { name: "C" } as unknown as Archetype;

/** A window over 8 slots whose handles carry each slot's current generation. */
function windowOf(): { window: TransitionWindow; generations: number[]; handle: (slot: number) => Entity } {
  const generations = new Array<number>(8).fill(0);
  const handle = (slot: number): Entity => packEntity(slot, generations[slot]!);
  return { window: new TransitionWindow(8, handle), generations, handle };
}

Deno.test("TransitionWindow records only the first move of a slot in a window", () => {
  const { window, handle } = windowOf();
  window.touch(2, A);
  window.touch(2, B);
  assertStrictEquals(window.originOf(handle(2)), A, "the window-start archetype, not the later one");
  assertStrictEquals(window.touchedCount, 1, "one touched slot");
  assertStrictEquals(window.originAt(2), A, "originAt");
  assertStrictEquals(window.handleAt(2), handle(2), "handleAt");
});

Deno.test("TransitionWindow originOf ignores untouched slots and other handles in a touched slot", () => {
  const { window, generations, handle } = windowOf();
  assertStrictEquals(window.originOf(handle(1)), undefined, "untouched");
  window.touch(1, A);
  const original = handle(1);
  generations[1] = 1;
  assertStrictEquals(window.originOf(handle(1)), undefined, "a newer handle in the same slot has no origin");
  assertStrictEquals(window.originOf(original), A, "the window-start handle keeps its origin");
});

Deno.test("TransitionWindow treats a slot that was empty at window start as having no origin", () => {
  const { window, handle } = windowOf();
  window.touch(4, undefined);
  window.touch(4, B);
  assertStrictEquals(window.touchedCount, 1, "the slot is touched once");
  assertStrictEquals(window.originAt(4), undefined, "no window-start archetype");
  assertStrictEquals(window.originOf(handle(4)), undefined, "a new entity has no origin");
});

Deno.test("TransitionWindow lists touched slots in first-touch order and clear forgets them", () => {
  const { window, handle } = windowOf();
  window.touch(5, A);
  window.touch(0, B);
  window.touch(5, C);
  window.touch(3, undefined);
  const touched = Array.from({ length: window.touchedCount }, (_, i) => window.touchedSlot(i));
  assertEquals(touched, [5, 0, 3], "first-touch order");

  window.clear();
  assertStrictEquals(window.touchedCount, 0, "cleared");
  assertStrictEquals(window.originOf(handle(5)), undefined, "origins forgotten");
  assertStrictEquals(window.originAt(5), undefined, "originAt forgotten");
  window.touch(5, C);
  assertStrictEquals(window.originOf(handle(5)), C, "a new window records afresh");
});

Deno.test("TransitionWindow capture and restore round-trip, and the snapshot is a copy", () => {
  const { window, generations, handle } = windowOf();
  window.touch(6, A);
  window.touch(1, undefined);
  const first = handle(6);
  const snapshot = window.capture();
  assertEquals(Array.from(snapshot.slots), [6, 1], "snapshot slots");
  assertEquals([...snapshot.origins], [A, undefined], "snapshot origins");

  window.clear();
  generations[6] = 3;
  window.touch(6, B);
  window.touch(2, C);
  assertEquals(Array.from(snapshot.slots), [6, 1], "later moves do not change the snapshot");

  window.restore(snapshot);
  assertStrictEquals(window.touchedCount, 2, "restore replaces, not merges");
  assertStrictEquals(window.originOf(first), A, "the captured handle and origin are back");
  assertStrictEquals(window.originOf(handle(6)), undefined, "the newer handle is not");
  assertStrictEquals(window.originOf(handle(2)), undefined, "slots touched after capture are forgotten");
  window.touch(6, C);
  assertStrictEquals(window.originOf(first), A, "a restored slot counts as touched");
});
