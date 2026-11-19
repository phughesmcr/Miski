/// <reference lib="deno.ns" />

import {
  AlreadyRegisteredError,
  type ComponentInstance,
  Query,
  Schedule,
  type ScheduleContext,
  SpecError,
  System,
  World,
  WorldRollbackScope,
  WorldStateError,
} from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, listIds } from "./helpers.ts";

const tag = tagComponent("tag");

/** A system that appends its name to `log` each time it runs. */
function logSystem(name: string, log: string[]): System<Record<string, never>, [ScheduleContext], void> {
  return new System({
    name,
    query: new Query({ all: [tag] }),
    argCount: 1,
    callback: (_components, _entities, _ctx: ScheduleContext) => {
      log.push(name);
    },
  });
}

/** A system that records a value derived from the context each time it runs. */
function probeSystem<T>(
  name: string,
  seen: T[],
  read: (ctx: ScheduleContext) => T,
): System<Record<string, never>, [ScheduleContext], void> {
  return new System({
    name,
    query: new Query({ all: [tag] }),
    argCount: 1,
    callback: (_components, _entities, ctx: ScheduleContext) => {
      seen.push(read(ctx));
    },
  });
}

async function setup(): Promise<World> {
  return await createTestWorld([tag]);
}

Deno.test("schedule runs phases in declared order and systems in insertion order", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world, { phases: ["input", "update", "render"] });
  schedule.add(logSystem("draw", log), { phase: "render" });
  schedule.add(logSystem("move", log), { phase: "update" });
  schedule.add(logSystem("read", log), { phase: "input" });
  schedule.add(logSystem("collide", log), { phase: "update" });
  schedule.run(0);
  assertEquals(log, ["read", "move", "collide", "draw"], "phase order, then insertion order within a phase");
  assertEquals(schedule.phases, ["input", "update", "render"], "phases are exposed in order");
  await world.destroy();
});

Deno.test("schedule defaults to a single update phase and to the first phase for add", async () => {
  const world = await setup();
  const log: string[] = [];
  const single = new Schedule(world);
  assertEquals(single.phases, ["update"], "default phase list");
  single.add(logSystem("a", log));
  assertEquals(single.getOrder("update"), ["a"], "default phase is update");
  const multi = new Schedule(world, { phases: ["first", "second"] });
  multi.add(logSystem("b", log));
  assertEquals(multi.getOrder("first"), ["b"], "add defaults to the first phase");
  await world.destroy();
});

Deno.test("schedule orders systems by before and after constraints", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const render = logSystem("render", log);
  const physics = logSystem("physics", log);
  const input = logSystem("input", log);
  schedule.add(render, { after: [physics] });
  schedule.add(physics, { after: ["input"] });
  schedule.add(input);
  schedule.add(logSystem("audio", log), { before: [render] });
  assertEquals(schedule.getOrder("update"), ["input", "physics", "audio", "render"], "constraint order");
  schedule.run(0);
  assertEquals(log, ["input", "physics", "audio", "render"], "run follows the computed order");
  await world.destroy();
});

Deno.test("schedule order is deterministic: ties break by insertion order", async () => {
  const build = async (): Promise<string[]> => {
    const world = await setup();
    const log: string[] = [];
    const schedule = new Schedule(world);
    schedule.add(logSystem("c", log), { after: ["a"] });
    schedule.add(logSystem("b", log));
    schedule.add(logSystem("a", log));
    schedule.add(logSystem("d", log), { before: ["c"] });
    const order = schedule.getOrder("update");
    await world.destroy();
    return order;
  };
  const first = await build();
  assertEquals(first, ["b", "a", "d", "c"], "earliest-inserted ready system runs first");
  assertEquals(await build(), first, "same inputs give the same order");
});

Deno.test("schedule reports cycles with the cycle path", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  schedule.add(logSystem("a", log), { after: ["c"] });
  schedule.add(logSystem("b", log), { after: ["a"] });
  schedule.add(logSystem("c", log), { after: ["b"] });
  schedule.add(logSystem("free", log));
  assertThrows(() => schedule.getOrder("update"), SpecError, "a -> b -> c -> a");
  assertThrows(() => schedule.run(0), SpecError, "cycle");
  assertEquals(log, [], "no system runs when the order cannot be built");
  await world.destroy();
});

Deno.test("schedule rejects self, unknown, and contradicting cross-phase constraints", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world, { phases: ["update", "render"] });
  const self = logSystem("self", log);
  assertThrows(() => schedule.add(self, { after: [self] }), SpecError, "itself");

  schedule.add(logSystem("orphan", log), { after: ["missing"] });
  assertThrows(() => schedule.getOrder("update"), SpecError, "missing");
  schedule.remove("orphan");

  schedule.add(logSystem("draw", log), { phase: "render" });
  schedule.add(logSystem("move", log), { phase: "update", before: ["draw"] });
  assertEquals(schedule.getOrder("update"), ["move"], "constraints that agree with phase order are allowed");
  schedule.add(logSystem("late", log), { phase: "update", after: ["draw"] });
  assertThrows(() => schedule.getOrder("update"), SpecError, "phase");
  await world.destroy();
});

Deno.test("schedule validates its spec and add options", async () => {
  const world = await setup();
  const log: string[] = [];
  assertThrows(() => new Schedule(world, { phases: [] }), SpecError, "phase");
  assertThrows(() => new Schedule(world, { phases: ["a", "a"] }), SpecError, "a");
  assertThrows(() => new Schedule(world, { phases: [""] }), SpecError, "phase");
  assertThrows(
    () => new Schedule(world, { phases: [{ name: "a", fixed: true }, "b", { name: "c", fixed: true }] }),
    SpecError,
    "contiguous",
  );
  assertThrows(() => new Schedule(world, { fixedStep: 0 }), SpecError, "fixedStep");
  assertThrows(() => new Schedule(world, { fixedStep: Number.NaN }), SpecError, "fixedStep");
  assertThrows(() => new Schedule(world, { maxFixedSteps: 0 }), SpecError, "maxFixedSteps");
  assertThrows(() => new Schedule(world, { maxFixedSteps: 1.5 }), SpecError, "maxFixedSteps");
  assertThrows(() => new Schedule({} as World), SpecError, "World");

  const schedule = new Schedule(world);
  assertThrows(() => schedule.add(logSystem("a", log), { phase: "nope" }), SpecError, "nope");
  assert(!schedule.has("a"), "a rejected add leaves no entry");
  schedule.add(logSystem("b", log));
  assertThrows(() => schedule.add(world.systems.get("b") as never), SpecError, "System");
  await world.destroy();
});

Deno.test("schedule accepts argCount 0, 1 or unset, and rejects 2+ and duplicate systems", async () => {
  const world = await setup();
  const schedule = new Schedule(world);
  const query = new Query({ all: [tag] });
  const wide = new System({
    name: "wide",
    query,
    argCount: 2,
    callback: (_c, _e, _ctx: ScheduleContext, _extra: number) => {},
  });
  // @ts-expect-error a scheduled system receives only the context
  assertThrows(() => schedule.add(wide), SpecError, "argCount");
  assert(!world.systems.has(wide), "a rejected system is not registered in the world");

  // Without argCount the system still receives the context, forwarded through rest/spread.
  const seen: unknown[][] = [];
  const loose = new System({
    name: "loose",
    query,
    callback: (_c, _e, ...args: [ctx: ScheduleContext]) => void seen.push(args),
  });
  schedule.add(loose);

  let ran = 0;
  const silent = new System({ name: "silent", query, argCount: 0, callback: () => void ran++ });
  schedule.add(silent);
  schedule.run(0);
  assertStrictEquals(ran, 1, "argCount 0 systems run without the context");
  assertEquals(seen, [[schedule.context]], "a system without argCount receives exactly the context");

  assertThrows(() => schedule.add(silent), AlreadyRegisteredError, "silent");
  await world.destroy();
});

Deno.test("schedule registers systems with the world, or reuses an existing registration", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const fresh = logSystem("fresh", log);
  schedule.add(fresh);
  assert(world.systems.has(fresh), "add registers an unregistered system");

  const existing = logSystem("existing", log);
  world.systems.register(existing);
  schedule.add(existing);
  schedule.run(0);
  assertEquals(log, ["fresh", "existing"], "both run");

  assert(schedule.remove(fresh), "remove reports a removed entry");
  assert(!schedule.remove(fresh), "remove reports a missing entry");
  assert(world.systems.has(fresh), "remove does not destroy the world system");
  log.length = 0;
  schedule.run(0);
  assertEquals(log, ["existing"], "removed systems no longer run");
  await world.destroy();
});

Deno.test("schedule rejects a system with the same name as a different registered system", async () => {
  const world = await setup();
  const log: string[] = [];
  world.systems.register(logSystem("twin", log));
  const schedule = new Schedule(world);
  assertThrows(() => schedule.add(logSystem("twin", log)), AlreadyRegisteredError, "twin");
  assert(!schedule.has("twin"), "the failed add leaves no entry");
  await world.destroy();
});

Deno.test("schedule runIf and setEnabled skip systems", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  let allow = false;
  const gated = logSystem("gated", log);
  schedule.add(gated, { runIf: (ctx) => allow && ctx.phase === "update" });
  schedule.add(logSystem("off", log), { enabled: false });
  schedule.add(logSystem("on", log));
  schedule.run(0);
  assertEquals(log, ["on"], "false runIf and disabled systems are skipped");
  assert(!schedule.isEnabled("off"), "isEnabled reports disabled");

  allow = true;
  assert(schedule.setEnabled("off", true), "setEnabled reports a scheduled system");
  schedule.setEnabled(gated, true);
  log.length = 0;
  schedule.run(0);
  assertEquals(log, ["gated", "off", "on"], "enabled and passing systems run");
  assert(schedule.isEnabled("off"), "isEnabled reports enabled");
  assertStrictEquals(schedule.setEnabled("nobody", true), false, "setEnabled reports a system not in the schedule");
  await world.destroy();
});

Deno.test("schedule passes one reused context with phase, dt, time, tick and alpha", async () => {
  const world = await setup();
  const schedule = new Schedule(world, {
    phases: ["input", { name: "physics", fixed: true }, "render"],
    fixedStep: 0.25,
    maxFixedSteps: 8,
  });
  type Seen = {
    phase: string;
    fixed: boolean;
    dt: number;
    time: number;
    tick: number;
    fixedTick: number;
    alpha: number;
  };
  const seen: Seen[] = [];
  const contexts = new Set<ScheduleContext>();
  const read = (ctx: ScheduleContext): Seen => {
    contexts.add(ctx);
    return {
      phase: ctx.phase,
      fixed: ctx.fixed,
      dt: ctx.dt,
      time: ctx.time,
      tick: ctx.tick,
      fixedTick: ctx.fixedTick,
      alpha: ctx.alpha,
    };
  };
  schedule.add(probeSystem("in", seen, read), { phase: "input" });
  schedule.add(probeSystem("phys", seen, read), { phase: "physics" });
  schedule.add(probeSystem("draw", seen, read), { phase: "render" });

  schedule.run(0.625); // 2 fixed steps, 0.125 left over
  assertEquals(seen, [
    { phase: "input", fixed: false, dt: 0.625, time: 0.625, tick: 1, fixedTick: 0, alpha: 0.5 },
    { phase: "physics", fixed: true, dt: 0.25, time: 0.25, tick: 1, fixedTick: 1, alpha: 0.5 },
    { phase: "physics", fixed: true, dt: 0.25, time: 0.5, tick: 1, fixedTick: 2, alpha: 0.5 },
    { phase: "render", fixed: false, dt: 0.625, time: 0.625, tick: 1, fixedTick: 2, alpha: 0.5 },
  ], "first run");

  seen.length = 0;
  schedule.run(0.125); // accumulator reaches 0.25: one step
  assertEquals(seen, [
    { phase: "input", fixed: false, dt: 0.125, time: 0.75, tick: 2, fixedTick: 2, alpha: 0 },
    { phase: "physics", fixed: true, dt: 0.25, time: 0.75, tick: 2, fixedTick: 3, alpha: 0 },
    { phase: "render", fixed: false, dt: 0.125, time: 0.75, tick: 2, fixedTick: 3, alpha: 0 },
  ], "second run");

  seen.length = 0;
  schedule.run(0.125); // no fixed step
  assertEquals(seen.map((s) => s.phase), ["input", "render"], "fixed phases are skipped when no step is due");
  assertStrictEquals(seen[0]!.alpha, 0.5, "alpha is the accumulator fraction");
  assertStrictEquals(contexts.size, 1, "one context object is reused for every call");
  assertStrictEquals([...contexts][0], schedule.context, "the reused context is exposed");
  assertStrictEquals(schedule.context.world, world, "context exposes the world");
  assertStrictEquals(schedule.context.commands, schedule.commands, "context exposes the command buffer");
  await world.destroy();
});

Deno.test("schedule runs contiguous fixed phases together per step", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world, {
    phases: [{ name: "physics", fixed: true }, { name: "ai", fixed: true }, "render"],
    fixedStep: 0.5,
  });
  schedule.add(logSystem("phys", log), { phase: "physics" });
  schedule.add(logSystem("think", log), { phase: "ai" });
  schedule.add(logSystem("draw", log), { phase: "render" });
  schedule.run(1);
  assertEquals(log, ["phys", "think", "phys", "think", "draw"], "each step runs the fixed group in order");
  await world.destroy();
});

Deno.test("schedule caps fixed steps per run and drops the excess", async () => {
  const world = await setup();
  let steps = 0;
  const schedule = new Schedule(world, {
    phases: [{ name: "physics", fixed: true }, "render"],
    fixedStep: 0.25,
    maxFixedSteps: 3,
  });
  const seenAlpha: number[] = [];
  schedule.add(
    new System({ name: "step", query: new Query({ all: [tag] }), argCount: 0, callback: () => void steps++ }),
    { phase: "physics" },
  );
  schedule.add(probeSystem("alpha", seenAlpha, (ctx) => ctx.alpha), { phase: "render" });
  schedule.run(2.125); // 8 steps due, capped at 3; whole excess steps dropped, 0.125 kept
  assertStrictEquals(steps, 3, "maxFixedSteps caps steps");
  assertStrictEquals(schedule.accumulator, 0.125, "whole excess steps are dropped");
  assertStrictEquals(seenAlpha[0], 0.5, "alpha uses the kept fraction");
  schedule.run(0.125);
  assertStrictEquals(steps, 4, "the kept fraction carries into the next run");
  await world.destroy();
});

Deno.test("schedule rejects invalid dt without touching its clock", async () => {
  const world = await setup();
  const schedule = new Schedule(world, { phases: [{ name: "fixed", fixed: true }], fixedStep: 0.5 });
  schedule.run(0.25);
  for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1, "1" as unknown as number]) {
    assertThrows(() => schedule.run(dt), RangeError, "dt");
  }
  assertStrictEquals(schedule.accumulator, 0.25, "accumulator unchanged");
  assertStrictEquals(schedule.context.tick, 1, "tick unchanged");
  await world.destroy();
});

Deno.test("schedule run refreshes once at the end, like world.frame", async () => {
  const world = await setup();
  const position = vec2Component("position");
  const local = await createTestWorld([position, tag]);
  const query = new Query({ all: [tag] });
  const enteredSeen: number[][] = [];
  const schedule = new Schedule(local, { phases: ["spawn", "observe"] });
  schedule.add(
    new System({
      name: "spawner",
      query,
      argCount: 1,
      callback: (_c, _e, ctx: ScheduleContext) => {
        const e = createEntity(ctx.world);
        ctx.world.components.addToEntity(tag, e);
      },
    }),
    { phase: "spawn" },
  );
  schedule.add(probeSystem("observer", enteredSeen, (ctx) => [...ctx.world.entities.queryEntered(query)]), {
    phase: "observe",
  });
  schedule.run(0);
  assertStrictEquals(enteredSeen[0]!.length, 1, "entered is visible during the run");
  assertEquals([...local.entities.queryEntered(query)], [], "the run refreshes the window at the end");
  await local.destroy();
  await world.destroy();
});

Deno.test("schedule refreshes, discards pending commands, and rethrows when a system throws", async () => {
  const world = await setup();
  const query = new Query({ all: [tag] });
  const victim = createEntity(world);
  world.components.addToEntity(tag, victim);
  world.refresh();
  const boom = new Error("boom");
  let fail = true;
  const schedule = new Schedule(world);
  schedule.add(
    new System({
      name: "thrower",
      query,
      argCount: 1,
      callback: (_c, _e, ctx: ScheduleContext) => {
        ctx.commands.destroy(victim);
        const spawned = createEntity(ctx.world);
        ctx.world.components.addToEntity(tag, spawned);
        if (fail) throw boom;
      },
    }),
  );
  let caught: unknown;
  try {
    schedule.run(0);
  } catch (error) {
    caught = error;
  }
  assertStrictEquals(caught, boom, "the system's error is rethrown unchanged");
  assert(world.entities.isActive(victim), "pending commands are discarded");
  assertStrictEquals(schedule.commands.pendingCount, 0, "the command buffer is empty");
  assertEquals([...world.entities.queryEntered(query)], [], "the world was refreshed");
  fail = false;
  schedule.run(0);
  assert(!world.entities.isActive(victim), "the schedule is usable after a failure");
  await world.destroy();
});

Deno.test("schedule run is not re-entrant", async () => {
  const world = await setup();
  const schedule = new Schedule(world);
  let inner: unknown;
  schedule.add(
    new System({
      name: "reenter",
      query: new Query({ all: [tag] }),
      argCount: 0,
      callback: () => {
        try {
          schedule.run(0);
        } catch (error) {
          inner = error;
        }
      },
    }),
  );
  schedule.run(0);
  assert(inner instanceof WorldStateError, "a nested run throws WorldStateError");
  schedule.run(0);
  await world.destroy();
});

Deno.test("schedule changes made during a run apply to the next run", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const late = logSystem("late", log);
  schedule.add(
    new System({
      name: "adder",
      query: new Query({ all: [tag] }),
      argCount: 0,
      callback: () => {
        log.push("adder");
        if (!schedule.has(late)) schedule.add(late);
        schedule.setEnabled("follower", false);
      },
    }),
  );
  schedule.add(logSystem("follower", log));
  schedule.run(0);
  assertEquals(log, ["adder"], "an added system waits for the next run; setEnabled applies at once");
  log.length = 0;
  schedule.setEnabled("follower", true);
  schedule.run(0);
  assertEquals(log, ["adder", "late"], "the added system runs next time; follower disabled again by adder");
  await world.destroy();
});

Deno.test("schedule getOrder during a run does not change the running plan", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world, { phases: ["a", "b"] });
  const late = logSystem("late", log);
  schedule.add(logSystem("leaver", log), { phase: "b" });
  schedule.add(
    new System({
      name: "changer",
      query: new Query({ all: [tag] }),
      argCount: 0,
      callback: () => {
        log.push("changer");
        if (schedule.has(late)) return;
        schedule.add(late, { phase: "b" });
        schedule.remove("leaver");
        assertEquals(schedule.getOrder("b"), ["late"], "getOrder reports the new plan");
      },
    }),
    { phase: "a" },
  );
  schedule.run(0);
  assertEquals(log, ["changer", "leaver"], "this run keeps the plan it started with");
  log.length = 0;
  schedule.run(0);
  assertEquals(log, ["changer", "late"], "the next run uses the new plan");
  await world.destroy();
});

Deno.test("schedule flushes commands at the end of each phase", async () => {
  const world = await setup();
  const query = new Query({ all: [tag] });
  const counts: number[] = [];
  const schedule = new Schedule(world, {
    phases: ["spawn", { name: "fixed", fixed: true }, "count"],
    fixedStep: 1,
  });
  schedule.add(
    new System({
      name: "spawner",
      query,
      argCount: 1,
      callback: (_c, entities, ctx: ScheduleContext) => {
        counts.push(entities.count);
        ctx.commands.spawn([[tag]]);
        counts.push(ctx.world.entities.queryList(query).count);
      },
    }),
    { phase: "spawn" },
  );
  schedule.add(
    new System({
      name: "stepper",
      query,
      argCount: 1,
      callback: (_c, entities, ctx: ScheduleContext) => {
        counts.push(entities.count);
        ctx.commands.spawn([[tag]]);
      },
    }),
    { phase: "fixed" },
  );
  schedule.add(probeSystem("counter", counts, (ctx) => ctx.world.entities.queryList(query).count), {
    phase: "count",
  });
  schedule.run(2);
  assertEquals(counts, [0, 0, 1, 2, 3], "same phase does not see its commands; later phases and steps do");
  await world.destroy();
});

Deno.test("schedule rethrows a command failure at a phase flush after applying the rest of the phase", async () => {
  const position = vec2Component("position");
  const world = await createTestWorld([position, tag], 16);
  const query = new Query({ all: [tag] });
  const anchor = createEntity(world);
  world.components.addToEntity(tag, anchor);
  const nonOwner = createEntity(world);
  const later = createEntity(world);
  world.refresh();
  const log: string[] = [];
  let fail = true;
  const schedule = new Schedule(world, { phases: ["a", "b"] });
  schedule.add(
    new System({
      name: "queuer",
      query,
      argCount: 1,
      callback: (_c, _e, ctx: ScheduleContext) => {
        log.push("queuer");
        if (fail) ctx.commands.set(position, nonOwner, { x: 1 });
        ctx.commands.add(position, later, { x: 2 });
      },
    }),
    { phase: "a" },
  );
  schedule.add(logSystem("next", log), { phase: "b" });
  let caught: unknown;
  try {
    schedule.run(0);
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error && caught.message.includes("CommandBuffer set position"), "flush error rethrown");
  assertEquals(log, ["queuer"], "later phases do not run after a failed flush");
  assertStrictEquals(world.components.getEntityData(position, later).x, 2, "the rest of the phase's commands applied");
  assertEquals([...world.entities.queryEntered(new Query({ all: [position] }))], [], "the world was refreshed");
  fail = false;
  log.length = 0;
  schedule.run(0);
  assertEquals(log, ["queuer", "next"], "the schedule is usable after a failed flush");
  await world.destroy();
});

Deno.test("schedule run throws when the world is not initialized", async () => {
  const world = new World({ capacity: 8, components: [tag] });
  const log: string[] = [];
  const schedule = new Schedule(world);
  schedule.add(logSystem("early", log));
  assertThrows(() => schedule.run(0), WorldStateError, "");
  assertStrictEquals(schedule.context.tick, 0, "a rejected run does not advance the clock");
  await world.init();
  schedule.run(0);
  assertEquals(log, ["early"], "systems added before init run once the world is initialized");
  await world.destroy();
  assertThrows(() => schedule.run(0), WorldStateError, "");
});

Deno.test("schedule drops a system once it is destroyed, so has() and run() agree", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const doomed = logSystem("doomed", log);
  const kept = logSystem("kept", log);
  schedule.add(doomed).add(kept);
  schedule.run(0);
  await world.systems.destroy(doomed);
  assert(!schedule.has("doomed"), "a destroyed system leaves the schedule");
  assert(!schedule.has(doomed), "has() by System agrees");
  assert(!schedule.isEnabled(doomed), "a dropped system is not enabled");
  assertEquals(schedule.getOrder("update"), ["kept"], "the order no longer lists it");
  schedule.run(0);
  assertEquals(log, ["doomed", "kept", "kept"], "the rest of the schedule keeps running");
  assert(!schedule.remove(doomed), "nothing left to remove");
  assertStrictEquals(schedule.setEnabled(doomed, false), false, "a dropped system cannot be enabled or disabled");
  await world.destroy();
});

Deno.test("schedule drops a destroyed system before run() without a has() call first", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const doomed = logSystem("doomed", log);
  schedule.add(doomed);
  schedule.run(0);
  await world.systems.destroy(doomed);
  schedule.run(0);
  assertEquals(log, ["doomed"], "run() skips the destroyed system instead of throwing");
  assert(!schedule.has(doomed), "has() agrees with run()");
  await world.destroy();
});

Deno.test("schedule: a system destroyed during a run throws if called later in that run, then is dropped", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const victim = logSystem("victim", log);
  let destroying: Promise<unknown> | undefined;
  const killer = new System({
    name: "killer",
    query: new Query({ all: [tag] }),
    argCount: 0,
    callback: () => {
      destroying ??= world.systems.destroy(victim);
    },
  });
  schedule.add(killer).add(victim);
  assertThrows(() => schedule.run(0), WorldStateError, "victim");
  await destroying;
  assert(!schedule.has(victim), "dropped once its destruction finished");
  schedule.run(0);
  assertEquals(log, [], "the victim never ran");
  await world.destroy();
});

Deno.test("schedule can re-add a system after it was destroyed", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world, { phases: ["a", "b"] });
  const system = logSystem("again", log);
  schedule.add(system, { phase: "b" });
  await world.systems.destroy(system);
  schedule.add(system, { phase: "a" });
  assert(world.systems.has(system), "add() registers it again");
  assertEquals(schedule.getOrder("a"), ["again"], "the new options apply");
  assertEquals(schedule.getOrder("b"), [], "the old entry is gone");
  schedule.run(0);
  assertEquals(log, ["again"], "it runs once");
  await world.destroy();
});

Deno.test("schedule drops a system that was destroyed and re-created directly on the world", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const system = logSystem("recreated", log);
  schedule.add(system);
  await world.systems.destroy(system);
  world.systems.register(system);
  assert(!schedule.has(system), "the schedule held the old registration, which is gone");
  schedule.run(0);
  assertEquals(log, [], "re-registering does not re-add it");
  schedule.add(system);
  schedule.run(0);
  assertEquals(log, ["recreated"], "adding it again schedules the new registration");
  await world.destroy();
});

Deno.test("schedule drops a system whose initial init failed", async () => {
  const world = new World({ capacity: 8, components: [tag] });
  const schedule = new Schedule(world);
  const failing = new System({
    name: "failing",
    query: new Query({ all: [tag] }),
    argCount: 0,
    init: () => {
      throw new Error("init failed");
    },
    callback: () => {},
  });
  schedule.add(failing);
  assert(schedule.has(failing), "scheduled before init");
  await world.init().catch(() => {});
  assert(!world.systems.has(failing), "the failed init unregistered it");
  assert(!schedule.has(failing), "an unregistered system is no longer scheduled");
  assertEquals(schedule.getOrder("update"), [], "the order no longer lists it");
  await world.destroy();
});

Deno.test("schedule ordering against a dropped system throws like an unknown name", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  const first = logSystem("first", log);
  schedule.add(first).add(logSystem("second", log), { after: [first] });
  await world.systems.destroy(first);
  assertThrows(() => schedule.run(0), SpecError, '"second" is ordered after "first", which is not in this schedule');
  schedule.remove("second");
  schedule.run(0);
  await world.destroy();
});

Deno.test("schedule propagates WorldStateError for a system whose init is pending", async () => {
  const world = await setup();
  const log: string[] = [];
  const schedule = new Schedule(world);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = new System({
    name: "slow",
    query: new Query({ all: [tag] }),
    argCount: 0,
    init: () => gate,
    callback: () => void log.push("slow"),
  });
  schedule.add(slow);
  assertThrows(() => schedule.run(0), WorldStateError, "slow");
  release();
  await world.onReady();
  schedule.run(0);
  assertEquals(log, ["slow"], "the system runs once its init has settled");
  await world.destroy();
});

Deno.test("schedule systems see their query entities", async () => {
  const world = await setup();
  const entity = createEntity(world);
  world.components.addToEntity(tag, entity);
  const seen: number[][] = [];
  const schedule = new Schedule(world);
  schedule.add(
    new System({
      name: "lister",
      query: new Query({ all: [tag] }),
      argCount: 1,
      callback: (_c, entities, _ctx: ScheduleContext) => void seen.push(listIds(entities)),
    }),
  );
  schedule.run(1 / 60);
  assertEquals(seen, [[entity]], "the borrowed entity list is passed");
  await world.destroy();
});

Deno.test("schedule takes a fixed step when frame dts sum to it within rounding", async () => {
  const world = await setup();
  let steps = 0;
  const schedule = new Schedule(world, { phases: [{ name: "physics", fixed: true }], fixedStep: 1 / 60 });
  schedule.add(
    new System({ name: "step", query: new Query({ all: [tag] }), argCount: 0, callback: () => void steps++ }),
    { phase: "physics" },
  );
  // Nine 1/540 frames sum to just under 1/60 in floating point; without a tolerance the step would wait a frame.
  let sum = 0;
  for (let frame = 1; frame <= 9; frame++) {
    sum += 1 / 540;
    schedule.run(1 / 540);
    assertStrictEquals(steps, frame === 9 ? 1 : 0, `frame ${frame}: the step is due only after the ninth frame`);
  }
  assert(sum < 1 / 60, "the summed dts really do fall short of the step");
  assertStrictEquals(schedule.accumulator, 0, "the rounding shortfall does not carry over as a negative remainder");
  assertStrictEquals(schedule.context.alpha, 0, "alpha is 0 after an exact step");
  const clock = schedule.getClock();
  schedule.setClock(clock);
  assertEquals(schedule.getClock(), clock, "the clock still round-trips");
  await world.destroy();
});

Deno.test("schedule setClock reduces an accumulator of a whole step or more to its remainder", async () => {
  const world = await setup();
  const seen: number[] = [];
  const schedule = new Schedule(world, { phases: [{ name: "physics", fixed: true }, "update"], fixedStep: 0.25 });
  schedule.add(probeSystem("alpha", seen, (ctx) => ctx.alpha), { phase: "update" });
  schedule.setClock({ tick: 0, fixedTick: 0, elapsed: 0, accumulator: 0.625 });
  assertStrictEquals(schedule.accumulator, 0.125, "whole steps are dropped");
  assertStrictEquals(schedule.context.alpha, 0.5, "alpha matches the reduced accumulator");
  schedule.setClock({ tick: 0, fixedTick: 0, elapsed: 0, accumulator: 0.25 * (1 - 1e-12) });
  assertStrictEquals(schedule.accumulator, 0, "a step within the tolerance counts as whole");
  schedule.run(0);
  assertEquals(seen, [0], "run() sees the reduced clock");
  await world.destroy();
});

Deno.test("schedule clock round-trips through getClock and setClock", async () => {
  const world = await setup();
  const seen: number[][] = [];
  const schedule = new Schedule(world, { phases: [{ name: "physics", fixed: true }, "update"], fixedStep: 0.25 });
  schedule.add(probeSystem("probe", seen, (ctx) => [ctx.tick, ctx.fixedTick, ctx.time, ctx.alpha]), {
    phase: "update",
  });
  assertEquals(schedule.getClock(), { tick: 0, fixedTick: 0, elapsed: 0, accumulator: 0 }, "fresh clock");
  schedule.run(0.375);
  const clock = schedule.getClock();
  assertEquals(clock, { tick: 1, fixedTick: 1, elapsed: 0.375, accumulator: 0.125 }, "clock after one run");
  (clock as { tick: number }).tick = 99;
  assertStrictEquals(schedule.getClock().tick, 1, "getClock returns a copy");

  schedule.run(0.5);
  schedule.setClock({ tick: 1, fixedTick: 1, elapsed: 0.375, accumulator: 0.125 });
  assertEquals(schedule.getClock(), { tick: 1, fixedTick: 1, elapsed: 0.375, accumulator: 0.125 }, "clock restored");
  assertStrictEquals(schedule.accumulator, 0.125, "accumulator restored");
  seen.length = 0;
  schedule.run(0.5);
  assertEquals(seen, [[2, 3, 0.875, 0.5]], "the next run continues from the restored clock");

  for (
    const bad of [
      { tick: -1, fixedTick: 0, elapsed: 0, accumulator: 0 },
      { tick: 1.5, fixedTick: 0, elapsed: 0, accumulator: 0 },
      { tick: 0, fixedTick: Number.NaN, elapsed: 0, accumulator: 0 },
      { tick: 0, fixedTick: 0, elapsed: Infinity, accumulator: 0 },
      { tick: 0, fixedTick: 0, elapsed: 0, accumulator: -0.5 },
    ]
  ) {
    assertThrows(() => schedule.setClock(bad), RangeError, "clock");
  }
  assertEquals(
    schedule.getClock(),
    { tick: 2, fixedTick: 3, elapsed: 0.875, accumulator: 0.125 },
    "rejected unchanged",
  );

  schedule.add(
    new System({
      name: "rewinder",
      query: new Query({ all: [tag] }),
      argCount: 0,
      callback: () => schedule.setClock({ tick: 0, fixedTick: 0, elapsed: 0, accumulator: 0 }),
    }),
    { phase: "update" },
  );
  assertThrows(() => schedule.run(0), WorldStateError, "running");
  await world.destroy();
});

Deno.test("schedule resumes identically after a rollback restore between runs plus setClock", async () => {
  const position = vec2Component("position");
  const world = await createTestWorld([position, tag], 64);
  for (let i = 0; i < 4; i++) world.entities.createWithOrThrow([[position, { x: i, y: 0 }], [tag]]);
  const movers = new Query({ all: [position, tag] });
  const schedule = new Schedule(world, { phases: [{ name: "physics", fixed: true }, "update"], fixedStep: 0.25 });
  const log: string[] = [];
  schedule.add(
    new System({
      name: "physics",
      query: movers,
      argCount: 1,
      callback: (components, entities, ctx: ScheduleContext) => {
        const p = (components["position"] as ComponentInstance<{ x: Float32ArrayConstructor }>).storage!.partitions;
        for (let i = 0; i < entities.count; i++) p.x[entities.slots[i]!] = p.x[entities.slots[i]!]! + ctx.dt;
        if (ctx.fixedTick % 3 === 0) ctx.commands.spawn([[position, { x: 0, y: ctx.fixedTick }], [tag]]);
      },
    }),
    { phase: "physics" },
  );
  schedule.add(
    new System({
      name: "cullAndLog",
      query: movers,
      argCount: 1,
      callback: (_components, entities, ctx: ScheduleContext) => {
        const rows: string[] = [];
        for (let i = 0; i < entities.count; i++) {
          const entity = entities.entities[i]!;
          const data = ctx.world.components.getEntityData(position, entity);
          // Slots, not handles: generations keep moving forward across a restore.
          rows.push(`${entities.slots[i]}:${data.x}:${data.y}`);
          if (data.x > 3) ctx.commands.destroy(entity);
        }
        log.push(`${ctx.tick}/${ctx.fixedTick}/${ctx.time}/${ctx.alpha} ${rows.sort().join(",")}`);
      },
    }),
    { phase: "update" },
  );
  const frames = [0.3, 0.4, 0.1, 0.55, 0.2, 0.75];
  schedule.run(0.3);
  schedule.run(0.3);
  log.length = 0;

  const point = new WorldRollbackScope(world);
  const clock = schedule.getClock();
  for (const dt of frames) schedule.run(dt);
  const first = log.splice(0);

  point.restore();
  schedule.setClock(clock);
  for (const dt of frames) schedule.run(dt);
  assertEquals(log, first, "same entities, values, ticks, times and alphas after resimulating");
  assertEquals(first.length, frames.length, "one log line per run");
  await world.destroy();
});
