/// <reference lib="deno.ns" />

// Scheduler and command buffer throughput. Kept in its own file so its worlds do not share an isolate (and heap)
// with the core benchmarks in miski.bench.ts.

import { CommandBuffer, Query } from "../mod.ts";
import type { Entity, ScheduleContext } from "../mod.ts";
import {
  createDispatchSchedule,
  MEDIUM_CAPACITY,
  populateScheduledMovementWorld,
  populateSparseLifecycleWorld,
  SMALL_CAPACITY,
} from "./fixtures.ts";

const scheduledFrame = await populateScheduledMovementWorld(MEDIUM_CAPACITY);
const manualFrame = await populateScheduledMovementWorld(MEDIUM_CAPACITY);
const manualMovement = manualFrame.world.systems.get("scheduledMovement") as (ctx: ScheduleContext) => void;
const manualRender = manualFrame.world.systems.get("scheduledRender") as () => void;
const dispatch16 = await createDispatchSchedule(16);
const dispatch64 = await createDispatchSchedule(64);

Deno.bench({
  name: "manual frame - movement + render systems + refresh",
  group: "scheduler",
  baseline: true,
  fn: () => {
    manualMovement(manualFrame.schedule.context);
    manualRender();
    manualFrame.world.refresh();
  },
});

Deno.bench({
  name: "Schedule.run - movement + render systems + refresh",
  group: "scheduler",
  fn: () => {
    scheduledFrame.schedule.run(1 / 60);
  },
});

Deno.bench({
  name: "Schedule.run - dispatch 16 no-op systems over 4 phases",
  group: "scheduler",
  fn: () => {
    dispatch16.schedule.run(1 / 60);
  },
});

Deno.bench({
  name: "Schedule.run - dispatch 64 no-op systems over 4 phases",
  group: "scheduler",
  fn: () => {
    dispatch64.schedule.run(1 / 60);
  },
});

const directTagWorld = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const commandTagWorld = await populateSparseLifecycleWorld(SMALL_CAPACITY);
const directTagEntities = directTagWorld.world.entities
  .querySnapshot(new Query({ all: [directTagWorld.components.position] }))
  .slice(0, 128);
const commandTagEntities = commandTagWorld.world.entities
  .querySnapshot(new Query({ all: [commandTagWorld.components.position] }))
  .slice(0, 128);
const commandTagBuffer = new CommandBuffer(commandTagWorld.world);

Deno.bench({
  name: "direct add/remove tag on 128 entities",
  group: "command buffer",
  baseline: true,
  fn: () => {
    const tag = directTagWorld.components.enemy;
    for (let i = 0; i < directTagEntities.length; i++) {
      directTagWorld.world.components.addToEntity(tag, directTagEntities[i]!);
    }
    for (let i = 0; i < directTagEntities.length; i++) {
      directTagWorld.world.components.removeFromEntity(tag, directTagEntities[i]!);
    }
  },
});

Deno.bench({
  name: "CommandBuffer add/remove tag on 128 entities + flush",
  group: "command buffer",
  fn: () => {
    const tag = commandTagWorld.components.enemy;
    for (let i = 0; i < commandTagEntities.length; i++) commandTagBuffer.add(tag, commandTagEntities[i]!);
    commandTagBuffer.flush();
    for (let i = 0; i < commandTagEntities.length; i++) commandTagBuffer.remove(tag, commandTagEntities[i]!);
    commandTagBuffer.flush();
  },
});

const directSpawnWorld = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const commandSpawnWorld = await populateSparseLifecycleWorld(MEDIUM_CAPACITY);
const commandSpawnBuffer = new CommandBuffer(commandSpawnWorld.world);
const directSpawned = new Array<Entity>(128);
const spawnPositionData = { x: 0, y: 0 };
const spawnVelocityData = { x: 10, y: -2 };
const directSpawnBundle = [
  [directSpawnWorld.components.position, spawnPositionData],
  [directSpawnWorld.components.velocity, spawnVelocityData],
  [directSpawnWorld.components.lifetime, { ttl: 2 }],
  [directSpawnWorld.components.renderable],
] as const;
const commandSpawnBundle = [
  [commandSpawnWorld.components.position, spawnPositionData],
  [commandSpawnWorld.components.velocity, spawnVelocityData],
  [commandSpawnWorld.components.lifetime, { ttl: 2 }],
  [commandSpawnWorld.components.renderable],
] as const;
const commandSpawnQuery = new Query({ all: [commandSpawnWorld.components.lifetime] });

Deno.bench({
  name: "direct createWith/destroy 128 bundles + refresh",
  group: "command buffer",
  fn: () => {
    for (let i = 0; i < 128; i++) {
      spawnPositionData.x = i;
      directSpawned[i] = directSpawnWorld.world.entities.createWithOrThrow(directSpawnBundle);
    }
    for (let i = 0; i < 128; i++) directSpawnWorld.world.entities.destroy(directSpawned[i]!);
    directSpawnWorld.world.refresh();
  },
});

Deno.bench({
  name: "CommandBuffer spawn/destroy 128 bundles + flush + refresh",
  group: "command buffer",
  fn: () => {
    for (let i = 0; i < 128; i++) {
      spawnPositionData.x = i;
      commandSpawnBuffer.spawn(commandSpawnBundle);
    }
    commandSpawnBuffer.flush();
    const list = commandSpawnWorld.world.entities.queryList(commandSpawnQuery);
    for (let i = 0; i < list.count; i++) commandSpawnBuffer.destroy(list.entities[i]!);
    commandSpawnBuffer.flush();
    commandSpawnWorld.world.refresh();
  },
});
