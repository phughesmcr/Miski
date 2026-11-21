/// <reference lib="deno.ns" />

import { loadWorld, Query, saveWorld, System, World, WorldRollbackScope, WorldStateError } from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertRejects, assertThrows, ids } from "./helpers.ts";

Deno.test("a rollback scope left without commit restores the world, even on throw", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const kept = createEntity(world);
  world.components.addToEntity(position, kept, { x: 1, y: 2 });
  const before = ids(Array.from(world.entities.getActive()));
  assertThrows(
    () => {
      using _scope = new WorldRollbackScope(world);
      createEntity(world);
      world.components.setEntityData(position, kept, { x: 9 });
      throw new Error("turn failed");
    },
    Error,
    "turn failed",
  );
  assertEquals(ids(Array.from(world.entities.getActive())), before, "Entities are restored");
  assertEquals(world.components.getEntityDataOrThrow(position, kept), { x: 1, y: 2 }, "Component values are restored");
  await world.destroy();
});

Deno.test("a committed rollback scope keeps writes and closes", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  let created: number | undefined;
  {
    using scope = new WorldRollbackScope(world);
    assert(scope.isOpen, "Scope opens on construction");
    created = createEntity(world);
    scope.commit();
    assert(!scope.isOpen, "Commit closes the scope");
    assertThrows(() => scope.commit(), WorldStateError, "already closed");
    assertThrows(() => scope.restore(), WorldStateError, "already closed");
  }
  assert(world.entities.isActive(created as never), "Committed writes survive the scope");
  await world.destroy();
});

Deno.test("an explicit restore closes the scope so disposal does nothing more", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  {
    using scope = new WorldRollbackScope(world);
    createEntity(world);
    scope.restore();
    assert(!scope.isOpen, "Restore closes the scope");
    createEntity(world);
  }
  assertEquals(Array.from(world.entities.getActive()).length, 1, "Writes after restore are kept by disposal");
  await world.destroy();
});

Deno.test("a disposed rollback scope frees the world for later captures and loads", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const bytes = saveWorld(world);
  try {
    using _scope = new WorldRollbackScope(world);
    assertThrows(() => new WorldRollbackScope(world), WorldStateError, "already active");
    assertThrows(() => loadWorld(world, bytes), WorldStateError, "rollback scope is active");
    throw new Error("leak");
  } catch {
    // expected
  }
  const next = new WorldRollbackScope(world);
  assert(next.isOpen, "A new rollback scope can open");
  await world.destroy();
});

Deno.test("disposing a rollback scope on a destroyed world drops the captured state without throwing", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const scope = new WorldRollbackScope(world);
  await world.destroy();
  scope[Symbol.dispose]();
  assert(!scope.isOpen, "The scope is closed");
  scope[Symbol.dispose]();
});

Deno.test("a rollback scope cannot open on a destroyed world", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  await world.destroy();
  assertThrows(() => new WorldRollbackScope(world), WorldStateError, "destroyed");
});

Deno.test("disposing a rollback scope on an errored world drops the captured state, and the world can still be destroyed", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  let scope: WorldRollbackScope | undefined;
  world.systems.register(
    new System({
      name: "speculativeInit",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => {
        scope = new WorldRollbackScope(world);
        throw new Error("init failed");
      },
    }),
  );
  await assertRejects(() => world.init(), Error, "init failed");
  assertEquals(world.state, "error", "Failed init leaves the error state");
  assert(scope?.isOpen === true, "The scope opened inside the hook");
  scope[Symbol.dispose]();
  assert(!scope.isOpen, "Disposal closes the scope without restoring");
  await world.destroy();
  assertEquals(world.state, "destroyed", "The errored world still tears down");
});
