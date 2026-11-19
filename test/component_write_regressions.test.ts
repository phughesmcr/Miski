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

Deno.test("instance.set writes without moving the shared proxy cursor", async () => {
  const mixed = mixedComponent();
  const world = await createTestWorld([mixed]);
  const instance = world.components.getInstanceOrThrow(mixed);
  const a = createEntity(world);
  const b = createEntity(world);
  world.components.addToEntity(mixed, a, { x: 1, alive: false, label: "a" });
  world.components.addToEntity(mixed, b, { x: 2, alive: false, label: "b" });
  const proxy = instance.proxy!;
  proxy.entity = a;

  // Numeric, codec (bool) and side (string) columns.
  instance.set(b, "x", 9);
  instance.set(b, "alive", true);
  instance.set(b, "label", "bee");
  assertEquals(proxy.entity, a, "set leaves the cursor on its entity");
  instance.set(b, "x", 10);
  instance.set(b, "alive", false);
  instance.set(b, "label", "bea");
  assertEquals(proxy.entity, a, "set leaves the cursor on its entity");
  assertEquals(proxy.slot, entityIndex(a), "set leaves the cursor slot");

  // The cursor kept entity mode, so its ownership guard still applies.
  assertEquals(proxy.x, 1, "proxy still reads a");
  assertEquals(proxy.label, "a", "proxy still reads a's side column");
  assertEquals(world.components.getEntityDataOrThrow(mixed, b), { x: 10, alive: false, label: "bea" }, "b was written");
  world.components.removeFromEntity(mixed, a);
  assertThrows(() => proxy.x, ComponentOwnershipError, "does not own");

  // Rejected writes leave the cursor alone too.
  proxy.entity = b;
  assertThrows(() => instance.set(a, "x", 1), ComponentOwnershipError, "does not own");
  assertThrows(() => instance.set(b, "x", Number.NaN), ComponentDataError, "finite number");
  assertThrows(() => instance.set(b, "alive", 1 as never), ComponentDataError, "must be a boolean");
  assertThrows(() => instance.set(b, "label", 1 as never), ComponentDataError, "");
  assertThrows(() => instance.set(b, "nope", 1), ComponentDataError, "does not define");
  assertThrows(() => instance.set(b, "toString", 1), ComponentDataError, "does not define");
  assertThrows(() => instance.set(asEntity(1_000), "x", 1), EntityNotFoundError, "");
  assertEquals(proxy.entity, b, "rejected writes leave the cursor");
  await world.destroy();
});

Deno.test("instance.set marks owners changed and bump the revision once per real change", async () => {
  const mixed = mixedComponent();
  const world = await createTestWorld([mixed]);
  const instance = world.components.getInstanceOrThrow(mixed);
  const a = createEntity(world);
  world.components.addToEntity(mixed, a, { x: 1, alive: false, label: "a" });
  const before = instance.revision;
  instance.set(a, "x", 1);
  assertEquals(instance.revision, before, "unchanged value does not bump the revision");
  instance.set(a, "x", 3);
  assertEquals(instance.revision, before + 1, "a real change bumps the revision");
  assert(ids(world.components.getChanged(mixed)).includes(a), "a is marked changed");
  instance.set(a, "label", "z");
  assertEquals(instance.revision, before + 2, "a side-column write bumps the revision");
  assertEquals(instance.get(a, "label") as unknown, "z", "set wrote the side column");
  await world.destroy();
});

Deno.test("instance.set covers enum, entity and object columns; non-owner slot writes skip tracking", async () => {
  const rich = new Component({
    name: "rich",
    schema: { state: field.enum(["idle", "run"]), target: field.entity(), mesh: field.object<{ id: number }>() },
  });
  const world = await createTestWorld([rich]);
  const instance = world.components.getInstanceOrThrow(rich);
  const a = createEntity(world);
  const t = createEntity(world);
  const free = createEntity(world);
  world.components.addToEntity(rich, a, { state: "idle", target: null, mesh: { id: 0 } });
  instance.proxy!.entity = a;
  const mesh = { id: 1 };
  instance.set(a, "state", "run");
  instance.set(a, "target", t);
  instance.set(a, "mesh", mesh);
  assertEquals(instance.proxy!.entity, a, "cursor unchanged");
  assertEquals(instance.get(a, "state") as unknown, "run", "enum written");
  assertEquals(instance.get(a, "target") as unknown, t, "entity written");
  assert(instance.get(a, "mesh") as unknown === mesh, "object written");
  assertThrows(() => instance.set(a, "state", "fly" as never), ComponentDataError, "");
  assertThrows(() => instance.set(a, "target", asEntity(1_000)), EntityNotFoundError, "not active");
  world.entities.destroy(t);
  assertEquals(instance.get(a, "target") as unknown, null, "stale entity decodes to null");

  assertThrows(() => instance.set(free, "state", "run"), ComponentOwnershipError, "does not own");
  const revision = instance.revision;
  instance.proxy!.slot = entityIndex(free) as SlotIndex;
  instance.proxy!.state = "run";
  assertEquals(instance.revision, revision, "non-owner slot writes do not bump the revision");
  assert(!ids(world.components.getChanged(rich)).includes(free), "non-owner slot writes are not marked changed");
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
