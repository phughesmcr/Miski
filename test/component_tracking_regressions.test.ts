/// <reference lib="deno.ns" />

import { type Entity, entityIndex, Query } from "../mod.ts";
import { ComponentManager } from "../src/component/component-manager.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, ids } from "./helpers.ts";

const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b);

Deno.test("a newly owned data component is changed whether or not a payload was passed", async () => {
  for (const maxOwners of [undefined, 8]) {
    const label = maxOwners === undefined ? "dense" : "capped";
    const position = vec2Component("position", { maxOwners });
    const marker = tagComponent("marker");
    const world = await createTestWorld([position, marker], 12);
    const { components, entities } = world;

    // addToEntity: no payload, empty payload, zero payload.
    const [a, b, c] = [createEntity(world), createEntity(world), createEntity(world)];
    world.refresh();
    components.addToEntity(position, a);
    components.addToEntity(position, b, {});
    components.addToEntity(position, c, { x: 0 });
    assertEquals(sorted(ids(components.getChanged(position))), sorted([a, b, c]), `${label}: addToEntity`);
    assertEquals(
      components.getEntityDataOrThrow(position, a),
      { x: 0, y: 0 },
      `${label}: no-payload add zero-initializes`,
    );

    // A no-payload re-add on an existing owner is not a change.
    world.refresh();
    components.addToEntity(position, a);
    assertEquals(ids(components.getChanged(position)), [], `${label}: no-payload re-add on an owner stays quiet`);

    // addToEntities without data.
    const [d, e] = [createEntity(world), createEntity(world)];
    components.addToEntity(marker, d);
    components.addToEntity(marker, e);
    world.refresh();
    const changedCount = components.addToEntities(position, entities.queryList(new Query({ all: [marker] })));
    assertStrictEquals(changedCount, 2, `${label}: addToEntities acquires two owners`);
    assertEquals(sorted(ids(components.getChanged(position))), sorted([d, e]), `${label}: addToEntities`);

    // addBundle without data.
    const f = createEntity(world);
    world.refresh();
    components.addBundle(f, [[position]]);
    assertEquals(ids(components.getChanged(position)), [f], `${label}: addBundle`);

    // create(bundle) without data.
    world.refresh();
    const g = entities.createOrThrow([[position], [marker]]);
    assertEquals(ids(components.getChanged(position)), [g], `${label}: create(bundle)`);

    // Tags still skip changed tracking.
    assertEquals(ids(components.getChanged(marker)), [], `${label}: tags are never changed`);
  }
});

Deno.test("applyCheckpoint does not truncate an in-progress getOwners iteration", async () => {
  const position = vec2Component("position");
  const world = await createTestWorld([position], 8);
  const owners: Entity[] = [];
  for (let i = 0; i < 4; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity, { x: i });
    owners.push(entity);
  }
  const checkpoint = world.captureCheckpoint([owners[0]!], position);

  const seen: number[] = [];
  for (const entity of world.components.getOwners(position)!) {
    seen.push(entityIndex(entity));
    if (seen.length === 1) world.applyCheckpoint(checkpoint);
  }
  assertEquals(seen, [0, 1, 2, 3], "Every owner is visited after a mid-iteration checkpoint apply");
});

Deno.test("a bundle spawn that fails mid-commit strips already-committed components", async () => {
  const capped = vec2Component("capped", { maxOwners: 2 });
  const position = vec2Component("position");
  const world = await createTestWorld([capped, position], 8);
  const cappedInstance = world.components.getInstanceOrThrow(capped);
  const cappedColumn = cappedInstance.storage!.partitions["x"] as unknown as ArrayLike<number | undefined>;
  world.refresh();

  const original = ComponentManager.prototype.addInstanceToEntity;
  const failure = new Error("injected mid-commit failure");
  let calls = 0;
  ComponentManager.prototype.addInstanceToEntity = function (this: ComponentManager, ...args) {
    if (++calls === 2) throw failure;
    return original.apply(this, args);
  } as typeof original;
  let thrown: unknown;
  try {
    world.entities.create([[capped, { x: 1 }], [position, { x: 2 }]]);
  } catch (error) {
    thrown = error;
  } finally {
    ComponentManager.prototype.addInstanceToEntity = original;
  }

  assertStrictEquals(thrown, failure, "The commit failure propagates");
  assertStrictEquals(calls, 2, "The first bundle entry committed before the failure");
  assertStrictEquals(world.entities.getActiveCount(), 0, "The spawned entity is rolled back");
  assertEquals(ids(world.components.getOwners(capped)), [], "No ownership leaks from the committed entry");
  assertEquals(ids(world.components.getChanged(capped)), [], "No changed mark leaks from the committed entry");
  assertStrictEquals(cappedColumn[0], undefined, "The capped sparse row is released");

  // Next-fit reuse: fill slots 1..7 so the allocator wraps back to the rolled-back slot.
  const fillers: Entity[] = [];
  for (let i = 1; i < 8; i++) fillers.push(createEntity(world));
  const reused = createEntity(world);
  assertStrictEquals(entityIndex(reused), 0, "The allocator reuses the rolled-back slot");
  for (const filler of fillers) world.entities.destroy(filler);
  assert(!world.components.entityHas(capped, reused), "The reused slot does not inherit ownership");
  assert(!world.components.entityHas(position, reused), "The failing entry did not commit");
  world.components.addToEntity(capped, reused, { x: 3 });
  world.components.addToEntity(capped, createEntity(world), { x: 4 });
  assertStrictEquals(ids(world.components.getOwners(capped)).length, 2, "The full owner cap is still available");
});
