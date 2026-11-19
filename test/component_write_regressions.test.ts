/// <reference lib="deno.ns" />

import {
  asEntity,
  compileComponentSchema,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  componentSchemaHash,
  entityIndex,
  EntityNotFoundError,
  field,
  Relation,
  type SlotIndex,
  SpecError,
} from "../mod.ts";
import { createEntity, createTestWorld } from "./fixtures.ts";
import { assert, assertEquals, assertThrows, ids } from "./helpers.ts";

function mixedComponent(): Component<
  { x: Float32ArrayConstructor; alive: ReturnType<typeof field.bool>; label: ReturnType<typeof field.string> }
> {
  return new Component({ name: "mixed", schema: { x: Float32Array, alive: field.bool(), label: field.string() } });
}

Deno.test("set / setAt write without moving the shared proxy cursor", async () => {
  const mixed = mixedComponent();
  const world = await createTestWorld([mixed]);
  const instance = world.components.require(mixed);
  const a = createEntity(world);
  const b = createEntity(world);
  world.components.addToEntity(mixed, a, { x: 1, alive: false, label: "a" });
  world.components.addToEntity(mixed, b, { x: 2, alive: false, label: "b" });
  const proxy = instance.proxy!;
  proxy.entity = a;

  // Numeric, codec (bool) and side (string) columns through both entry points.
  instance.set(b, "x", 9);
  instance.set(b, "alive", true);
  instance.set(b, "label", "bee");
  assertEquals(proxy.entity, a, "set leaves the cursor on its entity");
  instance.setAt(entityIndex(b) as SlotIndex, "x", 10);
  instance.setAt(entityIndex(b) as SlotIndex, "alive", false);
  instance.setAt(entityIndex(b) as SlotIndex, "label", "bea");
  assertEquals(proxy.entity, a, "setAt leaves the cursor on its entity");
  assertEquals(proxy.slot, entityIndex(a), "setAt leaves the cursor slot");

  // The cursor kept entity mode, so its ownership guard still applies.
  assertEquals(proxy.x, 1, "proxy still reads a");
  assertEquals(proxy.label, "a", "proxy still reads a's side column");
  assertEquals(world.components.getEntityData(mixed, b), { x: 10, alive: false, label: "bea" }, "b was written");
  world.components.removeFromEntity(mixed, a);
  assertThrows(() => proxy.x, ComponentOwnershipError, "does not own");

  // Rejected writes leave the cursor alone too.
  proxy.entity = b;
  assertThrows(() => instance.set(a, "x", 1), ComponentOwnershipError, "does not own");
  assertThrows(() => instance.set(b, "x", Number.NaN), TypeError, "");
  assertThrows(() => instance.set(b, "alive", 1 as never), ComponentDataError, "must be a boolean");
  assertThrows(() => instance.set(b, "label", 1 as never), ComponentDataError, "");
  assertThrows(() => instance.set(b, "nope", 1), ComponentDataError, "does not define");
  assertThrows(() => instance.set(b, "toString", 1), ComponentDataError, "does not define");
  assertThrows(() => instance.set(asEntity(1_000), "x", 1), EntityNotFoundError, "");
  assertThrows(() => instance.setAt(-1 as SlotIndex, "x", 1), EntityNotFoundError, "");
  assertThrows(() => instance.setAt(0.5 as SlotIndex, "x", 1), EntityNotFoundError, "");
  assertThrows(() => instance.setAt(8 as SlotIndex, "x", 1), EntityNotFoundError, "");
  assertEquals(proxy.entity, b, "rejected writes leave the cursor");
  await world.destroy();
});

Deno.test("set / setAt mark owners changed and bump the revision once per real change", async () => {
  const mixed = mixedComponent();
  const world = await createTestWorld([mixed]);
  const instance = world.components.require(mixed);
  const a = createEntity(world);
  world.components.addToEntity(mixed, a, { x: 1, alive: false, label: "a" });
  const before = instance.revision;
  instance.set(a, "x", 1);
  assertEquals(instance.revision, before, "unchanged value does not bump the revision");
  instance.set(a, "x", 3);
  assertEquals(instance.revision, before + 1, "a real change bumps the revision");
  assert(ids(world.components.getChanged(mixed)).includes(a), "a is marked changed");
  instance.setAt(entityIndex(a) as SlotIndex, "label", "z");
  assertEquals(instance.revision, before + 2, "setAt bumps the revision");
  assertEquals(instance.get(a, "label") as unknown, "z", "setAt wrote the side column");
  await world.destroy();
});

Deno.test("[Ctor, initial] column tuples are rejected with a SpecError", () => {
  const tuple = [Float32Array, 5];
  assertThrows(
    // @ts-expect-error tuple columns are not a ComponentFieldSpec
    () => new Component({ name: "t", schema: { v: [Float32Array, 5] } }),
    SpecError,
    "tuple form",
  );
  assertThrows(
    // @ts-expect-error tuple columns are not a ComponentFieldSpec (explicit generic)
    () => new Component<{ v: number }>({ name: "t", schema: { v: [Float32Array, 5] } }),
    SpecError,
    "tuple form",
  );
  const schema = { t: { v: tuple } } as never;
  assertThrows(() => compileComponentSchema(schema), SpecError, "tuple form");
  assertThrows(() => componentSchemaHash(schema), SpecError, "tuple form");
  assertThrows(() => new Relation({ name: "r", schema: { w: tuple } as never }), SpecError, "tuple form");
});
