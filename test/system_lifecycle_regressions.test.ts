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
    init: async (_world, hook) => {
      await Promise.resolve();
      await hook.destroySystem(system);
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
    init: async (_world, hook) => {
      await Promise.resolve();
      try {
        await hook.destroySystem(system);
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
    destroy: async (_world, hook) => {
      await Promise.resolve();
      await hook.destroySystem(system);
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
    init: async (_world, hook) => {
      await startA.promise;
      const destruction = hook.destroySystem(b);
      awaitingB.resolve();
      await destruction;
    },
  });
  const b: System = new System({
    name: "cycleB",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: async (_world, hook) => {
      await startB.promise;
      try {
        await hook.destroySystem(a);
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

// --- Lifecycle calls made synchronously inside a hook ---

type HookCall = "onReady" | "world.destroy" | "self systems.destroy";

/** Make `call` on the closure `world` from a hook body, before any `await`. */
function callFromHookBody(world: World, call: HookCall, self: () => System): Promise<void> {
  if (call === "onReady") return world.onReady();
  if (call === "world.destroy") return world.destroy();
  return world.systems.destroy(self());
}

for (const call of ["onReady", "world.destroy", "self systems.destroy"] as const) {
  Deno.test(`a synchronous ${call} from an initial init hook rejects with WorldStateError`, async () => {
    const tag = tagComponent("tag");
    const world = new World({ capacity: 8, components: [tag] });
    let pending: Promise<void> | undefined;
    const system: System = new System({
      name: "syncInitial",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => {
        pending = callFromHookBody(world, call, () => system);
        pending.catch(() => {});
      },
    });
    world.systems.create(system);
    await settleWithin(world.init(), "world.init()");
    assertSettledWith(await settleWithin(pending!, call), WorldStateError, call);
    assertEquals(world.state, "initialized", "A handled rejection leaves the world healthy");
    assert(world.systems.has(system), "The system stays registered");
    await world.destroy();
  });

  Deno.test(`a synchronous ${call} from a late init hook rejects with WorldStateError`, async () => {
    const tag = tagComponent("tag");
    const world = await createTestWorld([tag]);
    let pending: Promise<void> | undefined;
    const system: System = new System({
      name: "syncLate",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => {
        pending = callFromHookBody(world, call, () => system);
        pending.catch(() => {});
      },
    });
    world.systems.create(system);
    assertSettledWith(await settleWithin(pending!, call), WorldStateError, call);
    assert((await settleWithin(world.onReady(), "world.onReady()")).ok, "The world stays ready");
    await world.destroy();
  });

  Deno.test(`a synchronous ${call} from a destroy hook rejects with WorldStateError`, async () => {
    const tag = tagComponent("tag");
    const world = await createTestWorld([tag]);
    let pending: Promise<void> | undefined;
    const system: System = new System({
      name: "syncDestroy",
      query: new Query({ all: [tag] }),
      callback: () => {},
      destroy: () => {
        pending = callFromHookBody(world, call, () => system);
        pending.catch(() => {});
      },
    });
    world.systems.create(system);
    await world.onReady();
    assert((await settleWithin(world.systems.destroy(system), "systems.destroy()")).ok, "Destroy completes");
    assertSettledWith(await settleWithin(pending!, call), WorldStateError, call);
    await world.destroy();
  });

  Deno.test(`${call} through the hook context after an await rejects while the hook is pending`, async () => {
    const tag = tagComponent("tag");
    const world = await createTestWorld([tag]);
    let caught: unknown;
    const system: System = new System({
      name: "contextAfterAwait",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: async (_world, hook) => {
        await Promise.resolve();
        assert(hook.pending, "The hook is pending while it runs");
        try {
          if (call === "onReady") await hook.onReady();
          else if (call === "world.destroy") await hook.destroyWorld();
          else await hook.destroySystem(system);
        } catch (error) {
          caught = error;
        }
      },
    });
    world.systems.create(system);
    assert((await settleWithin(world.onReady(), "world.onReady()")).ok, "Readiness settles");
    assert(caught instanceof WorldStateError, `Expected WorldStateError, got ${String(caught)}`);
    assertEquals(world.state, "initialized", "A handled rejection leaves the world healthy");
    assert(world.systems.has(system), "The system stays registered");
    await world.destroy();
  });
}

Deno.test("a hook that throws synchronously does not leave its caller marker behind", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const failing = new System({
    name: "throwsSync",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: () => {
      throw new Error("boom");
    },
  });
  let thrown: unknown;
  try {
    world.systems.create(failing);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.message === "boom", "The hook error surfaces");
  const ready = await settleWithin(world.onReady(), "world.onReady()");
  const error = assertSettledWith(ready, WorldStateError, "world.onReady()");
  assert(!error.message.includes("hook"), `Outside calls are not treated as hook code, got "${error.message}"`);
});

Deno.test("a nested late init restores the outer hook as the caller", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  let pending: Promise<void> | undefined;
  const outer: System = new System({
    name: "outer",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: (hookWorld) => {
      hookWorld.systems.create(new System({ name: "inner", query: new Query({ all: [tag] }), callback: () => {} }));
      pending = world.systems.destroy(outer);
      pending.catch(() => {});
    },
  });
  world.systems.create(outer);
  assertSettledWith(await settleWithin(pending!, "systems.destroy()"), WorldStateError, "self destroy");
  await world.destroy();
});

Deno.test("the hook context behaves like the world once the hook has settled", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  let saved: import("../mod.ts").SystemHookContext | undefined;
  const system: System = new System({
    name: "keepsContext",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: (_world, hook) => {
      saved = hook;
    },
  });
  world.systems.create(system);
  await world.onReady();
  assert(!saved!.pending, "The hook has settled");
  assert((await settleWithin(saved!.onReady(), "hook.onReady()")).ok, "onReady resolves after the hook settles");
  assert((await settleWithin(saved!.destroySystem(system), "hook.destroySystem()")).ok, "destroySystem works");
  assert(!world.systems.has(system), "The system was destroyed");
  assert((await settleWithin(saved!.destroyWorld(), "hook.destroyWorld()")).ok, "destroyWorld works");
  assertEquals(world.state, "destroyed", "The world was destroyed");
});

for (const call of ["onReady", "world.destroy", "self systems.destroy"] as const) {
  Deno.test(`${call} through a destroy hook's context after an await rejects while the hook is pending`, async () => {
    const tag = tagComponent("tag");
    const world = await createTestWorld([tag]);
    let caught: unknown;
    const system: System = new System({
      name: "destroyContextAfterAwait",
      query: new Query({ all: [tag] }),
      callback: () => {},
      destroy: async (_world, hook) => {
        await Promise.resolve();
        try {
          if (call === "onReady") await hook.onReady();
          else if (call === "world.destroy") await hook.destroyWorld();
          else await hook.destroySystem(system);
        } catch (error) {
          caught = error;
        }
      },
    });
    world.systems.create(system);
    await world.onReady();
    assert((await settleWithin(world.systems.destroy(system), "systems.destroy()")).ok, "Destroy completes");
    assert(caught instanceof WorldStateError, `Expected WorldStateError, got ${String(caught)}`);
    assertEquals(world.state, "initialized", "The world stays healthy");
    await world.destroy();
  });
}

// --- The same calls on the closure `world` after an await: the world cannot tell the hook is calling ---

Deno.test("closure world.onReady after an await in a late init hook waits until teardown, then rejects", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const waiting = Promise.withResolvers<{ promise: Promise<void> }>();
  world.systems.create(
    new System({
      name: "closureOnReady",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: async () => {
        await Promise.resolve();
        const ready = world.onReady();
        waiting.resolve({ promise: ready });
        await ready.catch(() => {});
      },
    }),
  );
  const ready = (await waiting.promise).promise;
  const early = await settleWithin(ready, "world.onReady()", 50).catch((error) => error);
  assert(early instanceof Error && early.message.includes("never settled"), "It waits on its own hook");
  assert((await settleWithin(world.destroy(), "world.destroy()")).ok, "Teardown releases the wait");
  assertSettledWith(await settleWithin(ready, "world.onReady()"), WorldStateError, "world.onReady()");
});

Deno.test("closure systems.destroy of its own system after an await never settles", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const waiting = Promise.withResolvers<{ promise: Promise<void> }>();
  const system: System = new System({
    name: "closureSelfDestroy",
    query: new Query({ all: [tag] }),
    callback: () => {},
    init: async () => {
      await Promise.resolve();
      const destruction = world.systems.destroy(system);
      waiting.resolve({ promise: destruction });
      await destruction;
    },
  });
  world.systems.create(system);
  const destruction = (await waiting.promise).promise;
  const outcome = await settleWithin(destruction, "systems.destroy()", 50).catch((error) => error);
  assert(
    outcome instanceof Error && outcome.message.includes("never settled"),
    "Documented deadlock: use the hook context",
  );
});

Deno.test("closure world.onReady after an await in a destroy hook resolves when nothing else is pending", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  let outcome: Settled | undefined;
  const system: System = new System({
    name: "closureOnReadyInDestroy",
    query: new Query({ all: [tag] }),
    callback: () => {},
    destroy: async () => {
      await Promise.resolve();
      outcome = await settleWithin(world.onReady(), "world.onReady()");
    },
  });
  world.systems.create(system);
  await world.onReady();
  await settleWithin(world.systems.destroy(system), "systems.destroy()");
  assert(outcome?.ok === true, "Readiness does not wait for destroy hooks");
  await world.destroy();
});

Deno.test("closure world.destroy after an await in a destroy hook during teardown rejects", async () => {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  let outcome: Settled | undefined;
  world.systems.create(
    new System({
      name: "closureDestroyInTeardown",
      query: new Query({ all: [tag] }),
      callback: () => {},
      destroy: async () => {
        await Promise.resolve();
        outcome = await settleWithin(world.destroy(), "world.destroy()");
      },
    }),
  );
  await world.onReady();
  assert((await settleWithin(world.destroy(), "world.destroy()")).ok, "Teardown completes");
  assertSettledWith(outcome!, WorldStateError, "nested world.destroy()");
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
