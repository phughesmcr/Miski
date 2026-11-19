/// <reference lib="deno.ns" />

import {
  asEntity,
  compileComponentSchema,
  Component,
  ComponentOwnershipError,
  entityIndex,
  NotRegisteredError,
  WorldRollbackScope,
} from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertThrows, ids } from "./helpers.ts";

Deno.test("component schemas reject proxy cursor fields at every constructor boundary", () => {
  for (const key of ["entity", "slot"]) {
    const schema = { [key]: Float32Array, x: Float32Array };
    assertThrows(() => new Component({ name: "position", schema }), TypeError, "Invalid component specification");
    assertThrows(() => compileComponentSchema({ position: schema }), TypeError, "Invalid component specification");
  }
});

Deno.test("dense and capped storage initialize every new owner with zero defaults", async () => {
  for (const maxEntities of [undefined, 4]) {
    const position = vec2Component("position", { maxEntities });
    const world = await createTestWorld([position]);
    const instance = world.components.require(position);
    const bundled = world.entities.createWithOrThrow([[position]]);
    const single = createEntity(world);
    world.components.addToEntity(position, single);
    const batched = createEntity(world);
    world.components.addToEntities(position, {
      count: 1,
      entities: [batched],
      slots: [entityIndex(batched)],
    });
    const emptyPayload = world.entities.createWithOrThrow([[position, {}]]);
    for (const entity of [bundled, single, batched, emptyPayload]) {
      assertEquals(world.components.getEntityData(position, entity), { x: 0, y: 0 }, "New ownership defaults to zero");
      assertEquals(instance.get(entity, "x"), 0, "Guarded reads agree with copied data");
      instance.proxy!.entity = entity;
      assertEquals(instance.proxy!.y, 0, "Proxy reads agree with copied data");
    }
    const checkpoint = world.captureCheckpoint([bundled, single, batched, emptyPayload], position);
    instance.set(single, "x", 9);
    world.applyCheckpoint(checkpoint);
    assertEquals(instance.get(single, "x"), 0, "Default data survives a checkpoint roundtrip");
    world.components.setEntityData(position, single, { x: 3, y: 4 });
    world.components.removeFromEntity(position, single);
    world.components.addToEntity(position, single);
    assertEquals(
      world.components.getEntityData(position, single),
      { x: 0, y: 0 },
      "Reacquired storage clears prior values",
    );
    world.refresh();
    const revision = instance.revision;
    world.components.addToEntity(position, single);
    assertEquals(instance.revision, revision, "Adding an existing owner without data is idempotent");
    assertEquals(
      ids(world.components.getChanged(position)),
      [],
      "Default-only ownership does not mark numeric changes",
    );
    await world.destroy();
  }
});

Deno.test("component entity access rejects stale, malformed and unowned identities", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const old = world.entities.createWithOrThrow([[position, { x: 1 }]]);
  const instance = world.components.require(position);
  instance.proxy!.entity = old;
  world.entities.destroy(old);
  const replacement = world.entities.createWithOrThrow([[position, { x: 2 }]]);
  for (const entity of [old, asEntity(-1), asEntity(0.5), asEntity(Number.NaN), asEntity(2 ** 32 + replacement)]) {
    assert(!instance.has(entity), "Stale and noncanonical handles must not own replacement storage");
    assert(!world.components.entityHas(position, entity), "Manager ownership must validate identity");
    assert(!instance.markChanged(entity), "Stale changed markers must fail");
    assertThrows(() => instance.get(entity, "x"), ComponentOwnershipError, "does not own");
    assertThrows(() => instance.set(entity, "x", 9), Error, "");
  }
  assertThrows(
    () => {
      instance.proxy!.x = 10;
    },
    ComponentOwnershipError,
    "does not own",
  );
  assertEquals(instance.get(replacement, "x"), 2, "Rejected stale writes preserve replacement data");
  world.components.removeFromEntity(position, replacement);
  assertThrows(() => instance.get(replacement, "x"), ComponentOwnershipError, "does not own");
});

Deno.test("slot cursor marks the actual slot and every real write advances revisions", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag]);
  const a = world.entities.createWithOrThrow([[position, { x: 1 }]]);
  const b = world.entities.createWithOrThrow([[position, { x: 2 }]]);
  const instance = world.components.require(position);
  instance.set(a, "x", 3);
  world.refresh();
  let revision = instance.revision;
  instance.setAt(entityIndex(b), "x", 4);
  assertEquals(ids(world.components.getChanged(position)), [b], "setAt must not reuse a prior entity cursor");
  assert(instance.revision > revision, "First write advances revision");
  revision = instance.revision;
  instance.setAt(entityIndex(b), "y", 5);
  assert(instance.revision > revision, "Dirty-list dedup must not suppress later revision advances");
  revision = instance.revision;
  instance.setAt(entityIndex(b), "y", 5);
  assertEquals(instance.revision, revision, "Idempotent writes preserve revision");
  assertEquals(ids(world.components.getChanged(position)), [b], "Changed list remains deduplicated");
  const tagInstance = world.components.require(tag);
  revision = tagInstance.revision;
  world.components.addToEntity(tag, a);
  assert(tagInstance.revision > revision, "Uncapped tag membership advances revision");
});

Deno.test("dense and capped sparse storage share atomic canonical numeric writes", async () => {
  for (const maxEntities of [undefined, 2]) {
    const position = vec2Component("position", { maxEntities });
    const world = await createTestWorld([position]);
    const entity = world.entities.createWithOrThrow([[position, { x: 1, y: 1 }]]);
    const instance = world.components.require(position);
    world.refresh();
    const revision = instance.revision;
    for (
      const write of [
        () => world.components.setEntityData(position, entity, { x: 2, y: Number.MAX_VALUE }),
        () => world.components.addToEntity(position, entity, { x: 2, y: Number.MAX_VALUE }),
        () => instance.set(entity, "x", Number.MAX_VALUE),
        () => instance.setAt(entityIndex(entity), "x", Number.MAX_VALUE),
      ]
    ) assertThrows(write, TypeError, "outside its storage range");
    assertEquals(world.components.getEntityData(position, entity), { x: 1, y: 1 }, "Preflight rejects partial writes");
    assertEquals(instance.revision, revision, "Rejected writes preserve revision");
    assertEquals(ids(world.components.getChanged(position)), [], "Rejected writes preserve dirty state");
    world.components.addToEntity(position, entity, Object.create({ x: 99 }));
    assertEquals(instance.get(entity, "x"), 1, "Inherited values must never enter storage");
    world.components.setEntityData(position, entity, { x: 1.1, y: -Number.MIN_VALUE });
    assertEquals(instance.get(entity, "x"), Math.fround(1.1), "Writes use declared column coercion");
    assert(Object.is(instance.get(entity, "y"), 0), "Canonical writes normalize negative zero after coercion");
    const next = createEntity(world);
    assertThrows(
      () => world.components.addToEntity(position, next, { x: Number.MAX_VALUE }),
      TypeError,
      "outside its storage range",
    );
    assert(!instance.has(next), "Failed additions never acquire ownership");
  }
});

Deno.test("rollback restores capped mappings and pre-scope changes with fresh revision tokens", async () => {
  const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array }, maxEntities: 2 });
  const world = await createTestWorld([position]);
  const first = world.entities.createWithOrThrow([[position, { x: 1, y: 2 }]]);
  const second = world.entities.createWithOrThrow([[position, { x: 3, y: 4 }]]);
  world.refresh();
  const instance = world.components.require(position);
  instance.set(first, "x", 5);
  const point = new WorldRollbackScope(world);
  world.components.removeFromEntity(position, first);
  world.components.setEntityData(position, second, { x: 8, y: 9 });
  const third = world.entities.createWithOrThrow([[position, { x: 10, y: 11 }]]);
  const revision = instance.revision;
  point.restore();
  assertEquals(world.components.getEntityData(position, first), { x: 5, y: 2 }, "Restore first sparse mapping");
  assertEquals(world.components.getEntityData(position, second), { x: 3, y: 4 }, "Restore other shared columns");
  assert(!instance.has(third), "Discard speculative owner");
  assertEquals(ids(world.components.getChanged(position)), [first], "Restore original changed window");
  assert(instance.revision > revision, "Rollback never reuses component revision tokens");
});

Deno.test("component string lookup only resolves registered own names", async () => {
  const component = tagComponent("tag");
  const world = await createTestWorld([component]);
  assertEquals(world.components.require("tag").name, "tag", "Registered own name is valid");
  for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
    assert(!world.components.isRegistered(name), "Inherited object properties are not registered components");
    assertThrows(() => world.components.require(name), NotRegisteredError, "not registered");
  }
});

Deno.test("bundle and batch commits keep canonical scratch values isolated by component", async () => {
  const first = vec2Component("first");
  const second = vec2Component("second");
  const world = await createTestWorld([first, second]);
  const a = world.entities.createWithOrThrow([[first, { x: 1.1 }], [second, { x: 2.2 }]]);
  const b = world.entities.createWithOrThrow([[second, { x: 3.3 }]]);
  assertEquals(
    world.components.require(first).get(a, "x"),
    Math.fround(1.1),
    "Each bundle member keeps its own canonical data",
  );
  assertEquals(
    world.components.require(second).get(a, "x"),
    Math.fround(2.2),
    "Second member does not overwrite first scratch",
  );
  const entities = {
    count: 2,
    entities: new Uint32Array([a, b]),
    slots: new Uint32Array([entityIndex(a), entityIndex(b)]),
  };
  world.components.addToEntities(first, entities, { x: 4.4, y: 5.5 });
  for (const entity of [a, b]) {
    assertEquals(
      world.components.getEntityData(first, entity),
      { x: Math.fround(4.4), y: Math.fround(5.5) },
      "Batch repeats staged canonical payload",
    );
  }
});
