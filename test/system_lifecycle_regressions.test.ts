/// <reference lib="deno.ns" />

import { Query, System, World, WorldStateError } from "../mod.ts";
import { createEntity, createTestWorld, tagComponent } from "./fixtures.ts";
import { assert, assertEquals, assertRejects, listIds } from "./helpers.ts";

type Settled = { ok: true; value: unknown } | { ok: false; error: unknown };

/** Settle a promise, failing the test instead of hanging when it deadlocks. */
async function settleWithin(promise: Promise<unknown>, label: string, ms = 1000): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} never settled (deadlock)`)), ms);
  });
  try {
    return await Promise.race([
      promise.then((value): Settled => ({ ok: true, value }), (error): Settled => ({ ok: false, error })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertSettledWith(result: Settled, ErrorClass: new (...args: never[]) => Error, label: string): Error {
  assert(!result.ok, `${label}: expected a rejection, got fulfilment`);
  const { error } = result as { ok: false; error: unknown };
  assert(error instanceof ErrorClass, `${label}: expected ${ErrorClass.name}, got ${String(error)}`);
  return error;
}

/** Call `systems.destroy` and require a promise back, never a synchronous throw. */
function callDestroy(world: World, system: System | string): Promise<void> {
  let result: unknown;
  try {
    result = world.systems.destroy(system);
  } catch (error) {
    throw new Error(`systems.destroy threw synchronously instead of rejecting: ${String(error)}`);
  }
  assert(result instanceof Promise, "systems.destroy must return a promise");
  return result;
}

// --- Hooks awaiting their own destruction ---

Deno.test("an init hook awaiting its own systems.destroy rejects instead of deadlocking world.init", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const system: System = new System({
    name: "selfDestroyingInit",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: async () => {
      await Promise.resolve();
      await world.systems.destroy(system);
    },
  });
  world.systems.create(system);

  const result = await settleWithin(world.init(), "world.init()");
  const error = assertSettledWith(result, WorldStateError, "world.init()");
  assert(error.message.includes("selfDestroyingInit"), `Error names the system, got "${error.message}"`);
  await settleWithin(world.destroy(), "world.destroy()");
});

Deno.test("a late init hook can catch the rejection of its own systems.destroy and stay registered", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  let caught: unknown;
  const system: System = new System({
    name: "lateSelfDestroyingInit",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: async () => {
      await Promise.resolve();
      try {
        await world.systems.destroy(system);
      } catch (error) {
        caught = error;
      }
    },
  });
  world.systems.create(system);

  const ready = await settleWithin(world.onReady(), "world.onReady()");
  assert(ready.ok, `world.onReady() resolves once the hook handles the rejection: ${String(ready)}`);
  assert(caught instanceof WorldStateError, `Expected WorldStateError, got ${String(caught)}`);
  assert(world.systems.has(system), "A rejected self-destroy leaves the system registered");
  await world.systems.destroy(system);
  assert(!world.systems.has(system), "The system can still be destroyed normally afterwards");
  await world.destroy();
});

Deno.test("a destroy hook awaiting its own systems.destroy rejects instead of deadlocking", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const system: System = new System({
    name: "selfDestroyingDestroy",
    query: new Query({ all: [tag] }),
    callback: () => {},
    destroy: async () => {
      await Promise.resolve();
      await world.systems.destroy(system);
    },
  });
  world.systems.create(system);
  await world.onReady();

  const result = await settleWithin(world.systems.destroy(system), "systems.destroy()");
  assertSettledWith(result, WorldStateError, "systems.destroy()");
  assert(!world.systems.has(system), "The system is unregistered even though its destroy hook failed");
  await world.destroy();
});

Deno.test("hooks that await each other's systems.destroy reject the closing call instead of deadlocking", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const startA = Promise.withResolvers<void>();
  const startB = Promise.withResolvers<void>();
  const awaitingB = Promise.withResolvers<void>();
  let caughtByB: unknown;
  const a: System = new System({
    name: "cycleA",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: async () => {
      await startA.promise;
      const destruction = world.systems.destroy(b);
      awaitingB.resolve();
      await destruction;
    },
  });
  const b: System = new System({
    name: "cycleB",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: async () => {
      await startB.promise;
      try {
        await world.systems.destroy(a);
      } catch (error) {
        caughtByB = error;
      }
    },
  });
  world.systems.create(a);
  world.systems.create(b);

  startA.resolve();
  await awaitingB.promise;
  startB.resolve();
  const ready = await settleWithin(world.onReady(), "world.onReady()");
  assert(ready.ok, "Both hooks settle once the cycle is broken");
  assert(caughtByB instanceof WorldStateError, `Expected WorldStateError, got ${String(caughtByB)}`);
  assert(world.systems.has(a), "The hook that started the wait keeps its system");
  assert(!world.systems.has(b), "A hook may still destroy another system when no cycle forms");
  await world.destroy();
});

// --- systems.destroy always returns a promise ---

Deno.test("systems.destroy rejects rather than throwing synchronously after world teardown", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const system = new System({ name: "afterTeardown", query: new Query({ all: [tag] }), callback: () => {} });
  world.systems.create(system);
  await world.destroy();

  await assertRejects(() => callDestroy(world, system), WorldStateError, "World has already been destroyed");
  await assertRejects(() => callDestroy(world, "missing"), WorldStateError, "World has already been destroyed");
});

Deno.test("systems.destroy rejects rather than throwing synchronously while the world is being destroyed", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const system = new System({
    name: "duringTeardown",
    query: new Query({ all: [tag] }),
    callback: () => {},
    destroy: async () => {
      entered.resolve();
      await gate.promise;
    },
  });
  world.systems.create(system);
  const teardown = world.destroy();
  await entered.promise;
  try {
    await assertRejects(() => callDestroy(world, system), WorldStateError, "being destroyed");
  } finally {
    gate.resolve();
    await teardown;
  }
});

// --- none-only system queries ---

Deno.test("a system whose query only has none terms gets an empty components record and the matching entities", async () => {
  const disabled = tagComponent("disabled");
  const other = tagComponent("other");
  const world = await createTestWorld([disabled, other]);
  const off = createEntity(world);
  const on = createEntity(world);
  const tagged = createEntity(world);
  world.components.addToEntity(disabled, off);
  world.components.addToEntity(other, tagged);

  const query = new Query({ none: [disabled] });
  let seenComponents: string[] | undefined;
  let seenEntities: number[] | undefined;
  const sweep = world.systems.create(
    new System({
      name: "enabledSweep",
      query,
      callback: (components, entities) => {
        seenComponents = Object.keys(components);
        seenEntities = listIds(entities).sort((x, y) => x - y);
      },
    }),
  );
  sweep();

  assertEquals(seenComponents, [], "A none-only query exposes no components");
  assertEquals(seenEntities, [on, tagged].sort((x, y) => x - y), "Entities without the excluded component match");
  assertEquals(
    seenEntities,
    listIds(world.entities.queryList(query)).sort((x, y) => x - y),
    "The system sees the same entities as world.entities.queryList",
  );
  await world.destroy();
});
