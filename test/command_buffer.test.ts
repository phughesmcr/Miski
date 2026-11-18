/// <reference lib="deno.ns" />

import {
  CapacityError,
  CommandBuffer,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  defineComponentSchema,
  type Entity,
  entityIndex,
  NotRegisteredError,
  type PendingEntity,
  Query,
  SpecError,
  World,
} from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids } from "./helpers.ts";

const position = vec2Component("position");
const velocity = vec2Component("velocity");
const tag = tagComponent("tag");
const unregistered = tagComponent("unregistered");

async function setup(capacity = 16): Promise<{ world: World; commands: CommandBuffer }> {
  const world = await createTestWorld([position, velocity, tag], capacity);
  return { world, commands: new CommandBuffer(world) };
}

Deno.test("command buffer defers destroy until flush", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  commands.destroy(entity);
  assertStrictEquals(commands.size, 1, "one queued command");
  assert(world.entities.isActive(entity), "not applied before flush");
  commands.flush();
  assert(!world.entities.isActive(entity), "applied by flush");
  assertStrictEquals(commands.size, 0, "flush empties the buffer");
  await world.destroy();
});

Deno.test("command buffer add, set and remove mirror the direct APIs", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  commands.add(position, entity, { x: 1, y: 2 });
  commands.add(tag, entity);
  commands.flush();
  assertEquals(world.components.getEntityData(position, entity), { x: 1, y: 2 }, "add with data");
  assert(world.components.entityHas(tag, entity), "add tag");

  commands.add(position, entity, { x: 5 });
  commands.flush();
  assertEquals(world.components.getEntityData(position, entity), { x: 5, y: 2 }, "add upserts and keeps omitted");

  commands.set(position, entity, { y: 9 });
  commands.flush();
  assertEquals(world.components.getEntityData(position, entity), { x: 5, y: 9 }, "set keeps omitted fields");

  commands.remove(position, entity);
  commands.remove(tag, entity);
  commands.remove(velocity, entity);
  commands.flush();
  assert(!world.components.entityHas(position, entity), "remove data");
  assert(!world.components.entityHas(tag, entity), "remove tag");
  await world.destroy();
});

Deno.test("command buffer new ownership zeroes omitted fields even after other partial payloads", async () => {
  const { world, commands } = await setup();
  const a = createEntity(world);
  const b = createEntity(world);
  const c = createEntity(world);
  commands.add(position, a, { x: 1 });
  commands.add(position, b, { y: 2 });
  commands.add(position, c);
  commands.flush();
  assertEquals(world.components.getEntityData(position, a), { x: 1, y: 0 }, "a");
  assertEquals(world.components.getEntityData(position, b), { x: 0, y: 2 }, "b keeps no stale x");
  assertEquals(world.components.getEntityData(position, c), { x: 0, y: 0 }, "c");
  await world.destroy();
});

Deno.test("command buffer set leaves omitted fields untouched, even values the checked API would reject", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  const storage = world.components.getInstance(position)!.storage!;
  storage.partitions.y[entityIndex(entity)] = Number.POSITIVE_INFINITY;
  commands.set(position, entity, { x: 3 });
  commands.flush();
  assertStrictEquals(storage.partitions.x[entityIndex(entity)], 3, "x written");
  assertStrictEquals(storage.partitions.y[entityIndex(entity)], Number.POSITIVE_INFINITY, "y untouched");
  await world.destroy();
});

Deno.test("command buffer marks changed like the direct APIs", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1, y: 1 });
  world.refresh();
  commands.set(position, entity, { x: 2 });
  commands.flush();
  assertEquals(ids(world.components.getChanged(position)), [entity], "set marks changed");
  await world.destroy();
});

Deno.test("command buffer copies payloads when queued", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  const data = { x: 1, y: 2 };
  commands.add(position, entity, data);
  data.x = 100;
  commands.flush();
  assertEquals(world.components.getEntityData(position, entity), { x: 1, y: 2 }, "queued values are kept");
  await world.destroy();
});

Deno.test("command buffer spawn creates entities in order with bundles, and pending handles target them", async () => {
  const { world, commands } = await setup();
  const query = new Query({ all: [position, tag] });
  const a = commands.spawn([[position, { x: 1, y: 1 }], [tag]]);
  const b = commands.spawn();
  commands.add(velocity, b, { x: 3, y: 4 });
  commands.add(position, a, { y: 7 });
  assert((a as number) < 0 && (b as number) < 0, "pending handles never collide with real entities");
  assertStrictEquals(world.entities.getActiveCount(), 0, "nothing created before flush");
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 2, "both spawned");
  const [first] = world.entities.querySnapshot(query) as Entity[];
  assert(first !== undefined, "bundle spawn matches its query");
  assertEquals(world.components.getEntityData(position, first), { x: 1, y: 7 }, "later commands apply to the spawn");
  const velocityOwners = world.components.getOwnersSnapshot(velocity)!;
  assertStrictEquals(velocityOwners.length, 1, "the second spawn received velocity");
  assert(first < velocityOwners[0]!, "spawn order follows queue order");
  await world.destroy();
});

Deno.test("command buffer rejects pending handles from an earlier flush or another buffer", async () => {
  const { world, commands } = await setup();
  const stale = commands.spawn();
  commands.flush();
  assertThrows(() => commands.add(tag, stale), SpecError, "pending");
  const other = new CommandBuffer(world);
  other.spawn();
  const foreign = other.spawn();
  assertThrows(() => commands.destroy(foreign), SpecError, "pending");
  assertThrows(() => commands.destroy(-1 as PendingEntity), SpecError, "pending");
  const cleared = commands.spawn();
  commands.clear();
  assertThrows(() => commands.destroy(cleared), SpecError, "pending");
  await world.destroy();
});

Deno.test("command buffer skips commands whose target is no longer active", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  const gone = createEntity(world);
  world.entities.destroy(gone);
  commands.destroy(entity);
  commands.destroy(entity);
  commands.add(position, entity, { x: 1 });
  commands.set(position, entity, { x: 1 });
  commands.remove(position, entity);
  commands.add(tag, gone);
  const spawned = commands.spawn();
  commands.destroy(spawned);
  commands.add(tag, spawned);
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 0, "all targets inactive; nothing thrown");
  await world.destroy();
});

Deno.test("command buffer validates components and data when queued", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  assertThrows(() => commands.add(unregistered, entity), NotRegisteredError, "unregistered");
  assertThrows(() => commands.add(position, entity, { z: 1 } as never), ComponentDataError, "z");
  assertThrows(() => commands.add(position, entity, { x: Number.NaN }), ComponentDataError, "finite");
  assertThrows(() => commands.add(position, entity, { x: "1" as unknown as number }), ComponentDataError, "finite");
  assertThrows(() => commands.set(tag as never, entity, {}), ComponentDataError, "tag");
  assertThrows(() => commands.spawn([[unregistered]]), NotRegisteredError, "unregistered");
  assertThrows(() => commands.spawn([[position], [position]] as never), RangeError, "position");
  assertThrows(() => commands.destroy(1.5 as Entity), SpecError, "entity");
  assertStrictEquals(commands.size, 0, "rejected commands are not queued");
  await world.destroy();
});

Deno.test("command buffer flush failure keeps the applied prefix, drops the rest, and stays usable", async () => {
  const { world, commands } = await setup();
  const owner = createEntity(world);
  const nonOwner = createEntity(world);
  world.components.addToEntity(position, owner, { x: 0, y: 0 });
  commands.set(position, owner, { x: 1 });
  commands.set(position, nonOwner, { x: 2 });
  commands.set(position, owner, { x: 3 });
  let caught: unknown;
  try {
    commands.flush();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ComponentOwnershipError, "set on an active non-owner throws like the direct API");
  assert((caught as Error).message.includes("set"), "message names the command");
  assert((caught as Error).message.includes("position"), "message names the component");
  assertStrictEquals(world.components.getEntityData(position, owner).x, 1, "applied prefix stays");
  assertStrictEquals(commands.size, 0, "remaining commands are dropped");
  commands.set(position, owner, { x: 4 });
  commands.flush();
  assertStrictEquals(world.components.getEntityData(position, owner).x, 4, "buffer is reusable");
  await world.destroy();
});

Deno.test("command buffer spawn reports capacity errors", async () => {
  const { world, commands } = await setup(8);
  for (let i = 0; i < 8; i++) commands.spawn();
  assertThrows(() => commands.spawn(), CapacityError, "capacity");
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 8, "world full");
  commands.spawn();
  assertThrows(() => commands.flush(), CapacityError, "spawn");
  await world.destroy();
});

Deno.test("command buffer spawn respects component owner caps atomically", async () => {
  const hero = new Component({ name: "hero", schema: defineComponentSchema({ hp: Uint8Array }), maxEntities: 1 });
  const world = await createTestWorld([hero, tag]);
  const commands = new CommandBuffer(world);
  commands.spawn([[hero, { hp: 1 }]]);
  commands.spawn([[tag], [hero, { hp: 2 }]]);
  assertThrows(() => commands.flush(), RangeError, "hero");
  assertStrictEquals(world.entities.getActiveCount(), 1, "the failed spawn left no half-built entity");
  await world.destroy();
});

Deno.test("command buffer works with capped sparse components", async () => {
  const capped = vec2Component("capped", { maxEntities: 2 });
  const world = await createTestWorld([capped], 16);
  const commands = new CommandBuffer(world);
  const entities = [createEntity(world), createEntity(world), createEntity(world)];
  commands.add(capped, entities[2]!, { x: 1, y: 2 });
  commands.flush();
  commands.add(capped, entities[2]!, { y: 5 });
  commands.flush();
  assertEquals(world.components.getEntityData(capped, entities[2]!), { x: 1, y: 5 }, "sparse upsert keeps x");
  await world.destroy();
});

Deno.test("command buffer grows past its initial capacity", async () => {
  const world = await createTestWorld([position, tag], 4096);
  const commands = new CommandBuffer(world);
  for (let i = 0; i < 3000; i++) commands.spawn([[position, { x: i, y: -i }], [tag]]);
  assertStrictEquals(commands.size, 3000, "size counts commands, not bundle entries");
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 3000, "all spawned");
  const owners = world.components.getOwnersSnapshot(position)!;
  assertEquals(world.components.getEntityData(position, owners[2999]!), { x: 2999, y: -2999 }, "last payload kept");
  await world.destroy();
});

Deno.test("command buffer requires a world", () => {
  assertThrows(() => new CommandBuffer({} as World), SpecError, "World");
});

/** A component with `count` Float64 fields named f0..f(count-1). */
function wideComponent(name: string, count: number): Component<Record<string, number>> {
  const schema: Record<string, Float64ArrayConstructor> = {};
  for (let i = 0; i < count; i++) schema[`f${i}`] = Float64Array;
  return new Component<Record<string, number>>({ name, schema: defineComponentSchema(schema) });
}

function fields(count: number, values: Record<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < count; i++) out[`f${i}`] = values[i] ?? 0;
  return out;
}

Deno.test("command buffer handles partial payloads on the widest masked and on wide components", async () => {
  for (const count of [31, 40]) {
    const wide = wideComponent(`wide${count}`, count);
    const world = await createTestWorld([wide], 8);
    const commands = new CommandBuffer(world);
    const last = count - 1;
    const entity = createEntity(world);

    commands.add(wide, entity, { f0: 1, [`f${last}`]: 2 });
    commands.flush();
    assertEquals(world.components.getEntityData(wide, entity), fields(count, { 0: 1, [last]: 2 }), `${count}: add`);

    commands.set(wide, entity, { f1: 3 });
    commands.add(wide, entity, { [`f${last}`]: 4 });
    commands.flush();
    assertEquals(
      world.components.getEntityData(wide, entity),
      fields(count, { 0: 1, 1: 3, [last]: 4 }),
      `${count}: set and add keep omitted fields`,
    );

    const pending = commands.spawn();
    commands.add(wide, pending, { f2: 5 });
    commands.flush();
    const spawned = world.entities.querySnapshot(new Query({ all: [wide] })).find((e) => e !== entity)!;
    assertEquals(world.components.getEntityData(wide, spawned), fields(count, { 2: 5 }), `${count}: spawned add`);

    commands.remove(wide, entity);
    commands.flush();
    commands.add(wide, entity, { f3: 6 });
    commands.flush();
    assertEquals(world.components.getEntityData(wide, entity), fields(count, { 3: 6 }), `${count}: re-add zeroes`);

    const other = createEntity(world);
    commands.set(wide, other, { f0: 1 });
    assertThrows(() => commands.flush(), ComponentOwnershipError, `wide${count}`);
    await world.destroy();
  }
});
