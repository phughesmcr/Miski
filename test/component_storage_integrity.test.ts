/// <reference lib="deno.ns" />

import {
  asSlotIndex,
  compileComponentSchema,
  Component,
  createEcsWorld,
  entityIndex,
  isValidComponentSpec,
  Query,
  SpecError,
  World,
} from "../mod.ts";
import { createEntity, createTestWorld, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertThrows, ids } from "./helpers.ts";

type RawWrite = "partitions" | "proxy-slot";

/** Write to a (non-owner) slot through each documented raw/cursor path. */
function strayWrite(
  how: RawWrite,
  instance: NonNullable<ReturnType<World["components"]["getInstance"]>>,
  slot: number,
  value: number,
): void {
  if (how === "partitions") {
    (instance.storage!.partitions as Record<string, Float32Array>)["x"]![slot] = value;
  } else {
    instance.proxy!.slot = asSlotIndex(slot);
    (instance.proxy as unknown as Record<string, number>)["x"] = value;
  }
}

for (const how of ["partitions", "proxy-slot"] as const) {
  Deno.test(`capped add survives stray non-owner writes (${how}) without half-committing`, async () => {
    const position = vec2Component("position", { maxEntities: 2 });
    const world = await createTestWorld([position], 8);
    const instance = world.components.getInstanceOrThrow(position);
    const [a, b, c, d] = [createEntity(world), createEntity(world), createEntity(world), createEntity(world)];
    world.refresh();

    strayWrite(how, instance, entityIndex(a), 7);
    strayWrite(how, instance, entityIndex(b), 8);
    assertEquals(ids(world.components.getChanged(position)), [], "Non-owner writes must never be tracked as changed");

    // Both dense rows were consumed by stray writes; adds must still succeed and fully commit.
    world.components.addToEntity(position, c, { x: 1, y: 2 });
    assert(world.components.entityHas(position, c), "Add must grant ownership");
    assertEquals(world.components.getEntityDataOrThrow(position, c), { x: 1, y: 2 }, "Owner data must be stored");
    assertEquals(ids(world.entities.queryList(new Query({ all: [position] }))), [c], "Archetype/query must see owner");
    assertEquals(ids(world.components.getChanged(position)), [c], "Only owners appear in getChanged");

    // The cap itself still binds.
    world.components.addToEntity(position, d);
    assertThrows(
      () => world.components.addToEntity(position, a),
      RangeError,
      "can only be added to 2 entities",
    );
    assert(!world.components.entityHas(position, a), "Rejected add must not grant ownership");
  });
}

Deno.test("capped bundle, createWith and addToEntities survive stray non-owner writes", async () => {
  const position = vec2Component("position", { maxEntities: 2 });
  const world = await createTestWorld([position], 8);
  const instance = world.components.getInstanceOrThrow(position);
  const strays = [createEntity(world), createEntity(world)];
  strayWrite("partitions", instance, entityIndex(strays[0]!), 5);
  strayWrite("partitions", instance, entityIndex(strays[1]!), 6);

  const created = world.entities.createWithOrThrow([[position, { x: 3, y: 4 }]]);
  assertEquals(world.components.getEntityDataOrThrow(position, created), { x: 3, y: 4 }, "createWith commits fully");

  const bundled = createEntity(world);
  world.components.addBundle(bundled, [[position, { x: 9, y: 9 }]]);
  assertEquals(world.components.getEntityDataOrThrow(position, bundled), { x: 9, y: 9 }, "addBundle commits fully");
  assertEquals(ids(world.components.getOwners(position)).length, 2, "Both owners counted");
});

Deno.test("stray non-owner writes are discarded when ownership is acquired", async () => {
  for (const maxEntities of [undefined, 2]) {
    const position = vec2Component("position", { maxEntities });
    const world = await createTestWorld([position], 8);
    const instance = world.components.getInstanceOrThrow(position);
    const entity = createEntity(world);
    strayWrite("partitions", instance, entityIndex(entity), 42);
    world.components.addToEntity(position, entity);
    assertEquals(
      world.components.getEntityDataOrThrow(position, entity),
      { x: 0, y: 0 },
      "New ownership starts at zero",
    );
  }
});

Deno.test("acquiring ownership with data marks changed identically in dense and capped storage", async () => {
  for (const maxEntities of [undefined, 4]) {
    const label = maxEntities === undefined ? "dense" : "capped";
    const position = vec2Component("position", { maxEntities });
    const world = await createTestWorld([position], 8);

    // Zero payload on fresh storage.
    const zero = world.entities.createWithOrThrow([[position, { x: 0 }]]);
    assertEquals(ids(world.components.getChanged(position)), [zero], `${label}: zero payload marks changed`);
    world.refresh();

    // Payload equal to the previous owner's leftover value.
    const instance = world.components.getInstanceOrThrow(position);
    const first = createEntity(world);
    world.components.addToEntity(position, first, { x: 5 });
    world.components.removeFromEntity(position, first);
    world.refresh();
    strayWrite("partitions", instance, entityIndex(first), 5);
    world.components.addToEntity(position, first, { x: 5 });
    assertEquals(ids(world.components.getChanged(position)), [first], `${label}: equal payload marks changed`);
    world.refresh();

    // Re-applying an identical payload to an existing owner stays quiet; a no-payload add to a new owner marks.
    world.components.addToEntity(position, first, { x: 5 });
    assertEquals(ids(world.components.getChanged(position)), [], `${label}: idempotent upsert is not a change`);
    const bare = createEntity(world);
    world.components.addToEntity(position, bare);
    assertEquals(ids(world.components.getChanged(position)), [bare], `${label}: payload-less add marks a new owner`);
  }
});

Deno.test("owner caps above world capacity are clamped to capacity", async () => {
  const huge = vec2Component("huge", { maxEntities: 50_000_000 });
  const beyondArray = vec2Component("beyond", { maxEntities: 2 ** 31 });
  const before = performance.now();
  const world = await createTestWorld([huge, beyondArray], 8);
  assert(performance.now() - before < 5_000, "Capacity-8 world must not allocate cap-sized storage");

  const entities = Array.from({ length: 8 }, () => createEntity(world));
  for (const entity of entities) world.components.addToEntity(huge, entity, { x: 1 });
  assertEquals(ids(world.components.getOwners(huge)).length, 8, "Cap above capacity never binds before capacity");
  assertEquals(
    world.components.getEntityDataOrThrow(huge, entities[7]!),
    { x: 1, y: 0 },
    "Clamped storage reads and writes normally",
  );
  assertEquals(huge.maxEntities, 50_000_000, "The declared cap is unchanged on the component");
});

Deno.test("fractional maxEntities is rejected with TypeError", () => {
  for (const maxEntities of [1.5, 0.5, Number.NaN, -1, 0, Infinity]) {
    assert(!isValidComponentSpec({ name: "capped", maxEntities }), `Expected ${maxEntities} to be invalid`);
    assertThrows(() => new Component({ name: "capped", maxEntities }), TypeError, "Invalid component specification");
  }
  assertEquals(new Component({ name: "capped", maxEntities: 3 }).maxEntities, 3, "Integers remain valid");
});

Deno.test("column constructors are consistent across Component and compileComponentSchema", () => {
  const supported = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float16Array,
    Float32Array,
    Float64Array,
  ];
  for (const Ctor of supported) {
    const schema = { v: Ctor };
    assert(isValidComponentSpec({ name: "c", schema }), `${Ctor.name} valid for Component`);
    new Component({ name: "c", schema });
    compileComponentSchema({ c: schema });
  }
  const unsupported: unknown[] = [BigInt64Array, BigUint64Array];
  for (const Ctor of unsupported) {
    const schema = { v: Ctor } as never;
    assert(!isValidComponentSpec({ name: "c", schema }), `${(Ctor as { name: string }).name} invalid for Component`);
    assertThrows(() => new Component({ name: "c", schema }), TypeError, 'column "v"');
    assertThrows(() => compileComponentSchema({ c: schema }), TypeError, "typed-array");
    assertThrows(() => new Component({ name: "c", schema: { v: [Ctor, 0] } as never }), SpecError, "tuple form");
  }
});

Deno.test("adding Float16Array support leaves existing schema hashes unchanged", () => {
  const hash = compileComponentSchema({ c: { a: Float32Array, b: Uint8Array } }).schemaHash;
  assertEquals(hash, "3af682df5b7ddb6a", "Existing tags must keep their hashes");
  assert(
    compileComponentSchema({ c: { a: Float16Array, b: Uint8Array } }).schemaHash !== hash,
    "f16 hashes differently from f32",
  );
});

Deno.test("adding Uint8ClampedArray support leaves existing schema hashes unchanged", () => {
  const hash = compileComponentSchema({ c: { a: Float32Array, b: Uint8Array } }).schemaHash;
  assertEquals(hash, "3af682df5b7ddb6a", "Existing tags must keep their hashes");
  const clamped = compileComponentSchema({ c: { a: Uint8ClampedArray } });
  assert(clamped.schemaHash !== compileComponentSchema({ c: { a: Uint8Array } }).schemaHash, "Distinct tag");
});

Deno.test("EcsWorld.spawn treats undefined tag values as absent", async () => {
  const ecs = createEcsWorld({
    capacity: 8,
    components: { Position: { x: Float32Array } },
    tags: { Player: true },
  });
  await ecs.init();
  const entity = ecs.spawn({ Position: undefined, Player: undefined });
  assert(!ecs.world.components.entityHas("Player", entity), "Undefined tag spawns without the tag");
  const tagged = ecs.spawn({ Position: { x: 1 }, Player: true });
  assert(ecs.world.components.entityHas("Player", tagged), "true still adds the tag");
  assertThrows(() => ecs.spawn({ Player: false as never }), TypeError, "must be spawned with true");
});
