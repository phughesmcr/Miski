/// <reference lib="deno.ns" />

import { Query, System, World, WorldStateError } from "../mod.ts";
import type { WorldContext } from "../mod.ts";
import { tagComponent } from "./fixtures.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "./helpers.ts";

Deno.test("world teardown closes system registration and rejects concurrent teardown", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let destroyed = 0;
  const system = new System({
    name: "pausedDestroy",
    query: new Query({ all: [tag] }),
    callback: () => {},
    destroy: async (hookWorld) => {
      destroyed++;
      hookWorld.entities.createOrThrow();
      entered.resolve();
      await gate.promise;
    },
  });
  const run = world.systems.create(system);
  await world.init();
  const teardown = world.destroy();
  await entered.promise;
  try {
    assertThrows(
      () =>
        world.systems.create(
          new System({
            name: "lateDuringDestroy",
            query: new Query({ all: [tag] }),
            callback: () => {},
          }),
        ),
      WorldStateError,
      "being destroyed",
    );
    assertThrows(() => run(), WorldStateError, "not ready");
    await assertRejects(() => world.destroy(), WorldStateError, "being destroyed");
    await assertRejects(() => world.systems.destroy(system), WorldStateError, "being destroyed");
    await assertRejects(() => world.onReady(), WorldStateError, "being destroyed");
  } finally {
    gate.resolve();
    await teardown;
  }
  assertEquals(destroyed, 1, "Destroy hook runs exactly once");
  assertEquals(Object.keys(world.systems.registry), [], "No system survives teardown");
  assertEquals(world.state, "destroyed", "Teardown completes");
});

Deno.test("world initialization keeps hook mutations but delays callbacks and readiness", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const run = world.systems.create(
    new System({
      name: "pausedInit",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: async (hookWorld) => {
        hookWorld.entities.createOrThrow();
        entered.resolve();
        await gate.promise;
      },
    }),
  );
  const initialization = world.init();
  await entered.promise;
  let ready = false;
  const readiness = world.onReady().then(() => ready = true);
  try {
    assertThrows(() => run(), WorldStateError, "not ready");
    assert(!ready, "Readiness must wait for hooks");
  } finally {
    gate.resolve();
    await initialization;
    await readiness;
  }
  assertEquals(world.entities.getActiveCount(), 1, "Init hooks retain entity mutation access");
  run();
  await world.destroy();
});

Deno.test("late async system initialization delays callbacks and onReady", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const gate = Promise.withResolvers<void>();
  const run = world.systems.create(
    new System({
      name: "lateInit",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => gate.promise,
    }),
  );
  let ready = false;
  const readiness = world.onReady().then(() => ready = true);
  try {
    assertThrows(() => run(), WorldStateError, "not ready");
    await Promise.resolve();
    await Promise.resolve();
    assert(!ready, "Readiness includes pending late init");
  } finally {
    gate.resolve();
    await readiness;
  }
  run();
  await world.destroy();
});

Deno.test("systems registered during async world init are included in readiness", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const initialGate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const lateGate = Promise.withResolvers<void>();
  world.systems.create(
    new System({
      name: "initial",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => {
        entered.resolve();
        return initialGate.promise;
      },
    }),
  );
  const initialization = world.init();
  await entered.promise;
  world.systems.create(
    new System({
      name: "late",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => lateGate.promise,
    }),
  );
  let ready = false;
  const readiness = world.onReady().then(() => ready = true);
  initialGate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(!ready, "Initial readiness must include new pending hook");
  lateGate.resolve();
  await initialization;
  await readiness;
  await world.destroy();
});

Deno.test("world teardown unregisters failed hooks and still destroys remaining systems", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const destroyed: string[] = [];
  for (const name of ["bad", "good"]) {
    world.systems.create(
      new System({
        name,
        query: new Query({ all: [tag] }),
        callback: () => {},
        destroy: () => {
          destroyed.push(name);
          if (name === "bad") throw new Error("destroy failed");
        },
      }),
    );
  }
  await world.init();
  await assertRejects(() => world.destroy(), Error, "destroy failed");
  assertEquals(destroyed, ["bad", "good"], "Failure must not strand later hooks");
  assertEquals(Object.keys(world.systems.registry), [], "Failed teardown removes all registrations");
  assertEquals(world.state, "error", "Hook failure remains observable");
});

Deno.test("concurrent individual system teardown runs a hook only once", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const gate = Promise.withResolvers<void>();
  let destroyed = 0;
  const system = new System({
    name: "individual",
    query: new Query({ all: [tag] }),
    callback: () => {},
    destroy: () => {
      destroyed++;
      return gate.promise;
    },
  });
  world.systems.create(system);
  await world.init();
  const first = world.systems.destroy(system);
  const second = world.systems.destroy(system);
  gate.resolve();
  await Promise.all([first, second]);
  assertEquals(destroyed, 1, "Concurrent requests share one destroy hook");
  await world.destroy();
});

Deno.test("world teardown awaits late initialization before destroying that system", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  world.systems.create(
    new System({
      name: "lateTeardown",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: async () => {
        await gate.promise;
        calls.push("init");
      },
      destroy: () => {
        calls.push("destroy");
      },
    }),
  );
  const teardown = world.destroy();
  await Promise.resolve();
  assertEquals(calls, [], "Destroy waits for init completion");
  gate.resolve();
  await teardown;
  assertEquals(calls, ["init", "destroy"], "Init cannot outlive teardown");
});

Deno.test("failed world initialization rejects readiness and callbacks", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const run = world.systems.create(
    new System({
      name: "failedInit",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: async () => {
        await Promise.resolve();
        throw new Error("init failed");
      },
    }),
  );
  const readiness = assertRejects(() => world.onReady(), WorldStateError, 'state is "error"');
  await assertRejects(() => world.init(), Error, "init failed");
  await readiness;
  assertEquals(world.state, "error", "Failed init remains terminal");
  assertThrows(() => run(), WorldStateError, "encountered an error");
});

Deno.test("failed initialization rejects readiness without waiting for an unrelated late hook", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  const initial = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const late = Promise.withResolvers<void>();
  world.systems.create(
    new System({
      name: "initialFailure",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => {
        entered.resolve();
        return initial.promise;
      },
    }),
  );
  const initialization = assertRejects(() => world.init(), Error, "initial failed");
  await entered.promise;
  world.systems.create(
    new System({
      name: "unrelatedPending",
      query: new Query({ all: [tag] }),
      callback: () => {},
      init: () => late.promise,
    }),
  );
  initial.reject(new Error("initial failed"));
  await initialization;
  let rejected = false;
  const readiness = assertRejects(() => world.onReady(), WorldStateError, 'state is "error"').then(() => {
    rejected = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(rejected, "Failed readiness must reject before unrelated late init settles");
  } finally {
    late.resolve();
    await readiness;
  }
});

Deno.test("rejected pending system callbacks leave borrowed query views untouched", async () => {
  const tag = tagComponent("tag");
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const query = new Query({ all: [tag] });
  const borrowed = world.entities.queryList(query);
  world.entities.createWithOrThrow([[tag]]);
  const gate = Promise.withResolvers<void>();
  const run = world.systems.create(
    new System({
      name: "pendingBorrowedView",
      query,
      callback: () => {},
      init: () => gate.promise,
    }),
  );
  try {
    assertEquals(borrowed.count, 0, "Mutation leaves borrowed view stale until another successful query");
    assertThrows(() => run(), WorldStateError, "not ready");
    assertEquals(borrowed.count, 0, "Rejected invocation must not refresh borrowed cache");
  } finally {
    gate.resolve();
    await world.onReady();
    await world.destroy();
  }
});

function lifecycleTag() {
  return tagComponent("tag");
}

function makeSystem(
  tag: ReturnType<typeof lifecycleTag>,
  name: string,
  hooks: {
    init?: (world: WorldContext) => void | Promise<void>;
    destroy?: (world: WorldContext) => void | Promise<void>;
  },
) {
  return new System({ name, query: new Query({ all: [tag] }), callback: () => {}, ...hooks });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

Deno.test("frame propagates the callback error when it moves the world into error", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const rootCause = new Error("FRAME ROOT CAUSE");
  const bad = makeSystem(tag, "frameBad", {
    init: () => {
      throw rootCause;
    },
  });
  let caught: unknown;
  try {
    world.frame(() => {
      world.systems.create(bad);
    });
  } catch (error) {
    caught = error;
  }
  assert(caught === rootCause, `Expected the callback error to propagate, got ${String(caught)}`);
  assertEquals(world.state, "error", "Late init failure still poisons the world");
});

Deno.test("frame propagates a callback error and still refreshes a healthy world", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const failure = new Error("tick failed");
  let caught: unknown;
  try {
    world.frame(() => {
      throw failure;
    });
  } catch (error) {
    caught = error;
  }
  assert(caught === failure, "Callback error propagates unchanged");
  assertEquals(world.state, "initialized", "A callback error alone does not poison the world");
});

Deno.test("late async init failure after init surfaces the root cause through onReady", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const rootCause = new Error("ROOT CAUSE");
  world.systems.create(makeSystem(tag, "lateRoot", {
    init: async () => {
      await Promise.resolve();
      throw rootCause;
    },
  }));
  let caught: unknown;
  try {
    await world.onReady();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof WorldStateError, "onReady rejects with a WorldStateError");
  assert((caught as Error).cause === rootCause, "The root cause is reachable as `cause`");
  await settle();
  let later: unknown;
  try {
    world.entities.create();
  } catch (error) {
    later = error;
  }
  assert(later instanceof WorldStateError && later.cause === rootCause, "Later state errors carry the root cause");
});

Deno.test("an init hook that registers a failing late system rejects init with the root cause", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  const rootCause = new Error("NESTED ROOT CAUSE");
  world.systems.create(makeSystem(tag, "parent", {
    init: (hookWorld) => {
      hookWorld.systems.create(makeSystem(tag, "child", {
        init: async () => {
          await Promise.resolve();
          throw rootCause;
        },
      }));
    },
  }));
  let caught: unknown;
  try {
    await world.init();
  } catch (error) {
    caught = error;
  }
  assert(caught === rootCause, `Expected init to reject with the root cause, got ${String(caught)}`);
  assertEquals(world.state, "error", "Failed init is terminal");
  assert(!world.systems.has("child"), "Failed late system is unregistered");
});

Deno.test("destroy after a failed initial init destroys only systems whose init succeeded", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  const calls: string[] = [];
  const hooks = (name: string, fail = false) => ({
    init: () => {
      calls.push(`${name}:init`);
      if (fail) throw new Error(`${name} init failed`);
    },
    destroy: () => {
      calls.push(`${name}:destroy`);
    },
  });
  world.systems.create(makeSystem(tag, "a", hooks("a")));
  world.systems.create(makeSystem(tag, "b", hooks("b", true)));
  world.systems.create(makeSystem(tag, "c", hooks("c")));
  await assertRejects(() => world.init(), Error, "b init failed");
  assertEquals(Object.keys(world.systems.registry), ["a", "c"], "Failed system is unregistered");
  await world.destroy();
  assertEquals(calls, ["a:init", "b:init", "a:destroy"], "Only initialised systems are destroyed");
  assertEquals(Object.keys(world.systems.registry), [], "Teardown unregisters every system");
  assertEquals(world.state, "destroyed", "Cleanup of an errored world is terminal");
});

Deno.test("destroy from error still reports destroy hook failures and leaves the world in error", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  world.systems.create(makeSystem(tag, "ok", {
    destroy: () => {
      throw new Error("cleanup failed");
    },
  }));
  world.systems.create(makeSystem(tag, "bad", {
    init: () => {
      throw new Error("init failed");
    },
  }));
  await assertRejects(() => world.init(), Error, "init failed");
  await assertRejects(() => world.destroy(), Error, "cleanup failed");
  assertEquals(world.state, "error", "Destroy-hook failure leaves the world in error");
  assertEquals(Object.keys(world.systems.registry), [], "Failed teardown removes all registrations");
});

Deno.test("systems.destroy waits for that system's pending init", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  const system = makeSystem(tag, "pendingThenDestroyed", {
    init: async () => {
      calls.push("init-start");
      await gate.promise;
      calls.push("init-end");
    },
    destroy: () => {
      calls.push("destroy");
    },
  });
  world.systems.create(system);
  const destruction = world.systems.destroy(system);
  await settle();
  assertEquals(calls, ["init-start"], "Destroy waits for init to finish");
  gate.resolve();
  await destruction;
  assertEquals(calls, ["init-start", "init-end", "destroy"], "Destroy runs after init");
  await world.destroy();
});

Deno.test("systems.destroy skips the destroy hook of a system whose init never ran", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  const calls: string[] = [];
  const system = makeSystem(tag, "neverInitialised", {
    init: () => {
      calls.push("init");
    },
    destroy: () => {
      calls.push("destroy");
    },
  });
  world.systems.create(system);
  await world.systems.destroy(system);
  assertEquals(calls, [], "Neither hook runs for a system that never initialised");
  assert(!world.systems.has(system), "The system is still unregistered");
  await world.init();
  assertEquals(calls, [], "A destroyed system is not initialised later");
  await world.destroy();
});

Deno.test("a late init hook that awaits onReady is rejected instead of deadlocking", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  let hookError: unknown;
  world.systems.create(makeSystem(tag, "selfWaiting", {
    init: async () => {
      await Promise.resolve();
      try {
        await world.onReady();
      } catch (error) {
        hookError = error;
      }
    },
  }));
  await world.onReady();
  assert(hookError instanceof WorldStateError, "onReady rejects inside a hook");
  assert((hookError as Error).message.includes("hook"), "The message explains the hook restriction");
  assertEquals(world.state, "initialized", "A handled rejection leaves the world healthy");
  await world.destroy();
});

Deno.test("world.destroy does not hang on a late init hook that awaits onReady", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const entered = Promise.withResolvers<void>();
  world.systems.create(makeSystem(tag, "selfWaitingUnhandled", {
    init: async () => {
      entered.resolve();
      await world.onReady();
    },
  }));
  await entered.promise;
  const outcome = await Promise.race([
    world.destroy().then(() => "settled", () => "settled"),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 500)),
  ]);
  assertEquals(outcome, "settled", "Teardown must settle");
});

Deno.test("an initial init hook that awaits onReady is rejected instead of deadlocking", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  world.systems.create(makeSystem(tag, "initialSelfWaiting", {
    init: async () => {
      await world.onReady();
    },
  }));
  const outcome = await Promise.race([
    world.init().then(() => "resolved", (error) => error),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 500)),
  ]);
  assert(outcome instanceof WorldStateError, `Expected a WorldStateError rejection, got ${String(outcome)}`);
});

Deno.test("destroy right after an un-awaited init waits for it and then tears down", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  world.systems.create(makeSystem(tag, "slowInit", {
    init: async () => {
      calls.push("init-start");
      await gate.promise;
      calls.push("init-end");
    },
    destroy: () => {
      calls.push("destroy");
    },
  }));
  const initialization = world.init();
  const teardown = world.destroy();
  await settle();
  assertEquals(calls, ["init-start"], "Teardown waits for init");
  await assertRejects(() => world.destroy(), WorldStateError, "being destroyed");
  gate.resolve();
  await initialization;
  await teardown;
  assertEquals(calls, ["init-start", "init-end", "destroy"], "Teardown runs after init");
  assertEquals(world.state, "destroyed", "Teardown completes");
});

Deno.test("destroy right after an un-awaited failing init waits for it and cleans up", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  world.systems.create(makeSystem(tag, "good", {
    destroy: () => {
      calls.push("good:destroy");
    },
  }));
  world.systems.create(makeSystem(tag, "slowFailure", {
    init: async () => {
      await gate.promise;
      throw new Error("slow init failed");
    },
    destroy: () => {
      calls.push("slowFailure:destroy");
    },
  }));
  const initialization = assertRejects(() => world.init(), Error, "slow init failed");
  const teardown = world.destroy();
  await settle();
  assertEquals(world.state, "initialized", "Teardown waits while init is pending");
  gate.resolve();
  await initialization;
  await teardown;
  assertEquals(calls, ["good:destroy"], "Only the successfully initialised system is destroyed");
  assertEquals(world.state, "destroyed", "Cleanup completes after a failed init");
});

Deno.test("world.destroy surfaces the root cause of a late init failure that happens during teardown", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  const gate = Promise.withResolvers<void>();
  const rootCause = new Error("TEARDOWN ROOT CAUSE");
  world.systems.create(makeSystem(tag, "failsDuringTeardown", {
    init: async () => {
      await gate.promise;
      throw rootCause;
    },
  }));
  const teardown = world.destroy();
  await settle();
  gate.resolve();
  let caught: unknown;
  try {
    await teardown;
  } catch (error) {
    caught = error;
  }
  assert(caught === rootCause, `Expected the root cause, got ${String(caught)}`);
  assertEquals(world.state, "error", "A late init failure still poisons the world");
});

Deno.test("calls made after a hook settles are not mistaken for hook code", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  await world.init();
  let afterHook: Promise<void> | undefined;
  world.systems.create(makeSystem(tag, "spawnsTimer", {
    init: () => {
      afterHook = new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => world.onReady());
    },
  }));
  await world.onReady();
  await afterHook;
  await world.destroy();
});

Deno.test("world destroy is idempotent once the world is destroyed", async () => {
  const tag = lifecycleTag();
  const world = new World({ capacity: 8, components: [tag] });
  let destroyed = 0;
  world.systems.create(makeSystem(tag, "countDestroy", {
    destroy: () => {
      destroyed++;
    },
  }));
  await assertRejects(() => world.destroy(), WorldStateError, "not been initialized");
  await world.init();
  await world.destroy();
  await world.destroy();
  await world.destroy();
  assertEquals(destroyed, 1, "Destroy hooks run once");
  assertEquals(world.state, "destroyed", "World stays destroyed");
});
