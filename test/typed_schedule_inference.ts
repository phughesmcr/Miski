/// <reference lib="deno.ns" />

// Compile-only checks for Schedule and CommandBuffer typing. Type-checked by `deno task check`, not executed.

import { CommandBuffer, Component, defineComponentSchema, Query, Schedule, System, World } from "../mod.ts";
import type { Entity, PendingEntity, ScheduleContext } from "../mod.ts";

const position = new Component({
  name: "position",
  schema: defineComponentSchema({ x: Float32Array, y: Float32Array }),
});
const tag = new Component({ name: "tag" });
const world = new World({ capacity: 8, components: [position, tag] });
const schedule = new Schedule(world, { phases: ["update", { name: "physics", fixed: true }] });

const scheduled = new System({
  name: "scheduled",
  query: new Query({ all: { position } }),
  argCount: 1,
  callback: (components, entities, ctx: ScheduleContext): void => {
    const x = components.position.storage.partitions.x;
    const dt: number = ctx.dt;
    const commands: CommandBuffer = ctx.commands;
    for (let i = 0; i < entities.count; i++) x[entities.slots[i]!]! += dt;
    commands.add(tag, entities.entities[0]!);
    // @ts-expect-error the context is read-only for systems
    ctx.dt = 1;
  },
});
schedule.add(scheduled, { phase: "physics", after: ["other"], runIf: (ctx) => ctx.tick > 0 });

const noContext = new System({ name: "noContext", query: new Query({ all: [tag] }), argCount: 0, callback: () => {} });
schedule.add(noContext);

const wrongArg = new System({
  name: "wrongArg",
  query: new Query({ all: [tag] }),
  argCount: 1,
  callback: (_c, _e, dt: number) => void dt,
});
// @ts-expect-error a scheduled system receives the schedule context, not a number
schedule.add(wrongArg);

// @ts-expect-error runIf receives the context and must return a boolean
schedule.add(noContext, { runIf: (ctx: ScheduleContext) => ctx.dt });

const commands = new CommandBuffer(world);
const pending: PendingEntity = commands.spawn([[position, { x: 1 }], [tag]]);
commands.add(position, pending, { y: 2 });
commands.set(position, pending, { x: 3 });
commands.remove(tag, pending);
const real = 0 as Entity;
commands.destroy(real);
// @ts-expect-error unknown data fields are rejected
commands.add(position, real, { z: 1 });
// @ts-expect-error tags take no data
commands.add(tag, real, { x: 1 });
// @ts-expect-error set requires a data component
commands.set(tag, real, {});
// @ts-expect-error a pending entity is not a world entity
world.entities.destroy(pending);
// @ts-expect-error a plain number is neither an entity nor a pending entity
commands.destroy(1);
