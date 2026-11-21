/// <reference lib="deno.ns" />

// deno-lint-ignore-file no-await-in-loop -- worlds are built and checked one after another on purpose

import {
  ArgumentError,
  CapacityError,
  CommandBuffer,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  defineComponentSchema,
  type DynamicComponent,
  type Entity,
  entityIndex,
  EntityNotFoundError,
  field,
  NotRegisteredError,
  type PendingEntity,
  Prefab,
  Query,
  Relation,
  SpecError,
  type World,
} from "../mod.ts";
import { createEntity, createTestWorld, Mesh, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids } from "./helpers.ts";

const position = vec2Component("position");
const velocity = vec2Component("velocity");
const tag = tagComponent("tag");
const unregistered = tagComponent("unregistered");

/** A unit with every field kind, for the field-type flush tests. */
const unit = new Component({
  name: "unit",
  schema: {
    hp: Uint16Array,
    alive: field.bool(),
    state: field.enum(["idle", "run"]),
    target: field.entity(),
    label: field.string(),
    mesh: field.object<Mesh>(),
  },
});
const childOf = new Relation({ name: "childOf", exclusive: true });
const fieldComponents: DynamicComponent[] = [unit, childOf];

async function setup(capacity = 16): Promise<{ world: World; commands: CommandBuffer }> {
  const world = await createTestWorld([position, velocity, tag], capacity);
  return { world, commands: new CommandBuffer(world) };
}

Deno.test("command buffer defers destroy until flush", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  commands.destroy(entity);
  assertStrictEquals(commands.pendingCount, 1, "one queued command");
  assert(world.entities.isActive(entity), "not applied before flush");
  commands.flush();
  assert(!world.entities.isActive(entity), "applied by flush");
  assertStrictEquals(commands.pendingCount, 0, "flush empties the buffer");
  await world.destroy();
});

Deno.test("command buffer add, set and remove mirror the direct APIs", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  commands.add(position, entity, { x: 1, y: 2 });
  commands.add(tag, entity);
  commands.flush();
  assertEquals(world.components.getDataOrThrow(position, entity), { x: 1, y: 2 }, "add with data");
  assert(world.components.has(tag, entity), "add tag");

  commands.add(position, entity, { x: 5 });
  commands.flush();
  assertEquals(
    world.components.getDataOrThrow(position, entity),
    { x: 5, y: 2 },
    "add upserts and keeps omitted",
  );

  commands.set(position, entity, { y: 9 });
  commands.flush();
  assertEquals(world.components.getDataOrThrow(position, entity), { x: 5, y: 9 }, "set keeps omitted fields");

  commands.remove(position, entity);
  commands.remove(tag, entity);
  commands.remove(velocity, entity);
  commands.flush();
  assert(!world.components.has(position, entity), "remove data");
  assert(!world.components.has(tag, entity), "remove tag");
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
  assertEquals(world.components.getDataOrThrow(position, a), { x: 1, y: 0 }, "a");
  assertEquals(world.components.getDataOrThrow(position, b), { x: 0, y: 2 }, "b keeps no stale x");
  assertEquals(world.components.getDataOrThrow(position, c), { x: 0, y: 0 }, "c");
  await world.destroy();
});

Deno.test("command buffer set leaves omitted fields untouched, even values the checked API would reject", async () => {
  const { world, commands } = await setup();
  const entity = createEntity(world);
  world.components.add(position, entity, { x: 1, y: 2 });
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
  world.components.add(position, entity, { x: 1, y: 1 });
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
  assertEquals(world.components.getDataOrThrow(position, entity), { x: 1, y: 2 }, "queued values are kept");
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
  const [first] = Array.from(world.entities.query(query)) as Entity[];
  assert(first !== undefined, "bundle spawn matches its query");
  assertEquals(
    world.components.getDataOrThrow(position, first),
    { x: 1, y: 7 },
    "later commands apply to the spawn",
  );
  const velocityOwners = Array.from(world.components.getOwners(velocity))!;
  assertStrictEquals(velocityOwners.length, 1, "the second spawn received velocity");
  assert(first < velocityOwners[0]!, "spawn order follows queue order");
  await world.destroy();
});

Deno.test("command buffer rejects pending handles from an earlier flush or another buffer", async () => {
  const { world, commands } = await setup();
  const stale = commands.spawn();
  commands.flush();
  assertThrows(() => commands.add(tag, stale), ArgumentError, "pending");
  const other = new CommandBuffer(world);
  other.spawn();
  const foreign = other.spawn();
  assertThrows(() => commands.destroy(foreign), ArgumentError, "pending");
  assertThrows(() => commands.destroy(-1 as PendingEntity), ArgumentError, "pending");
  const cleared = commands.spawn();
  commands.clear();
  assertThrows(() => commands.destroy(cleared), ArgumentError, "pending");
  await world.destroy();
});

Deno.test("command buffer rejects real handles outside the world's slot range", async () => {
  const { world, commands } = await setup(16);
  for (const handle of [16, 0x10010, 0x80000000, 1.5]) {
    assertThrows(() => commands.destroy(handle as Entity), ArgumentError, "Invalid entity handle");
  }
  commands.destroy(15 as Entity); // in range: accepted at queue time, skipped at flush if inactive
  commands.clear();
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
  assertThrows(() => commands.spawn([[position], [position]] as never), ArgumentError, "position");
  assertThrows(() => commands.destroy(1.5 as Entity), ArgumentError, "entity");
  assertStrictEquals(commands.pendingCount, 0, "rejected commands are not queued");
  await world.destroy();
});

Deno.test("command buffer flush failure applies the remaining commands, then rethrows the first error", async () => {
  const { world, commands } = await setup();
  const owner = createEntity(world);
  const nonOwner = createEntity(world);
  const otherNonOwner = createEntity(world);
  const doomed = createEntity(world);
  world.components.add(position, owner, { x: 0, y: 0 });
  commands.set(position, owner, { x: 1 });
  commands.set(position, nonOwner, { x: 2 });
  commands.set(position, owner, { x: 3 });
  commands.set(position, otherNonOwner, { x: 4 });
  commands.add(tag, owner);
  commands.destroy(doomed);
  let caught: unknown;
  try {
    commands.flush();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ComponentOwnershipError, "set on an active non-owner throws like the direct API");
  const message = (caught as Error).message;
  assert(message.includes("set") && message.includes("position"), "message names the command and component");
  assert(message.includes(`entity ${nonOwner}`), "the first failure is the one rethrown");
  assertStrictEquals(world.components.getDataOrThrow(position, owner).x, 3, "commands after the failure applied");
  assert(world.components.has(tag, owner), "later add applied");
  assert(!world.entities.isActive(doomed), "later destroy applied");
  assertStrictEquals(commands.pendingCount, 0, "buffer is empty");
  commands.set(position, owner, { x: 5 });
  commands.flush();
  assertStrictEquals(world.components.getDataOrThrow(position, owner).x, 5, "buffer is reusable");
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
  const hero = new Component({ name: "hero", schema: defineComponentSchema({ hp: Uint8Array }), maxOwners: 1 });
  const world = await createTestWorld([hero, tag]);
  const commands = new CommandBuffer(world);
  commands.spawn([[hero, { hp: 1 }]]);
  const failed = commands.spawn([[tag], [hero, { hp: 2 }]]);
  commands.add(tag, failed);
  commands.destroy(failed);
  commands.spawn([[tag]]);
  assertThrows(() => commands.flush(), CapacityError, "hero");
  assertStrictEquals(world.entities.getActiveCount(), 2, "failed spawns leave no half-built entity; later ones run");
  assertStrictEquals(Array.from(world.components.getOwners(hero))!.length, 1, "one hero");
  assertStrictEquals(Array.from(world.components.getOwners(tag))!.length, 1, "commands on a failed spawn are skipped");
  await world.destroy();
});

Deno.test("command buffer works with capped sparse components", async () => {
  const capped = vec2Component("capped", { maxOwners: 2 });
  const world = await createTestWorld([capped], 16);
  const commands = new CommandBuffer(world);
  const entities = [createEntity(world), createEntity(world), createEntity(world)];
  commands.add(capped, entities[2]!, { x: 1, y: 2 });
  commands.flush();
  commands.add(capped, entities[2]!, { y: 5 });
  commands.flush();
  assertEquals(world.components.getDataOrThrow(capped, entities[2]!), { x: 1, y: 5 }, "sparse upsert keeps x");
  await world.destroy();
});

Deno.test("command buffer grows past its initial capacity", async () => {
  const world = await createTestWorld([position, tag], 4096);
  const commands = new CommandBuffer(world);
  for (let i = 0; i < 3000; i++) commands.spawn([[position, { x: i, y: -i }], [tag]]);
  assertStrictEquals(commands.pendingCount, 3000, "pendingCount counts commands, not bundle entries");
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 3000, "all spawned");
  const owners = Array.from(world.components.getOwners(position))!;
  assertEquals(
    world.components.getDataOrThrow(position, owners[2999]!),
    { x: 2999, y: -2999 },
    "last payload kept",
  );
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
    assertEquals(
      world.components.getDataOrThrow(wide, entity),
      fields(count, { 0: 1, [last]: 2 }),
      `${count}: add`,
    );

    commands.set(wide, entity, { f1: 3 });
    commands.add(wide, entity, { [`f${last}`]: 4 });
    commands.flush();
    assertEquals(
      world.components.getDataOrThrow(wide, entity),
      fields(count, { 0: 1, 1: 3, [last]: 4 }),
      `${count}: set and add keep omitted fields`,
    );

    const pending = commands.spawn();
    commands.add(wide, pending, { f2: 5 });
    commands.flush();
    const spawned = Array.from(world.entities.query(new Query({ all: [wide] }))).find((e) => e !== entity)!;
    assertEquals(
      world.components.getDataOrThrow(wide, spawned),
      fields(count, { 2: 5 }),
      `${count}: spawned add`,
    );

    commands.remove(wide, entity);
    commands.flush();
    commands.add(wide, entity, { f3: 6 });
    commands.flush();
    assertEquals(
      world.components.getDataOrThrow(wide, entity),
      fields(count, { 3: 6 }),
      `${count}: re-add zeroes`,
    );

    const other = createEntity(world);
    commands.set(wide, other, { f0: 1 });
    assertThrows(() => commands.flush(), ComponentOwnershipError, `wide${count}`);
    await world.destroy();
  }
});

Deno.test("command buffer passes non-numeric schema fields through a side column", async () => {
  // Stand-in for field-types descriptors: any schema entry that is not a typed-array constructor is non-numeric.
  const point = new Component({ name: "point", schema: defineComponentSchema({ x: Float32Array, y: Float32Array }) });
  const world = await createTestWorld([point], 16);
  Object.defineProperty(point, "schema", { value: { x: { kind: "side" }, y: Float32Array }, configurable: true });
  const commands = new CommandBuffer(world);
  const entity = createEntity(world);
  const passed: Record<string, unknown>[] = [];
  const add = world.components.add;
  Object.defineProperty(world.components, "add", {
    value: (component: never, target: never, data?: Record<string, unknown>) => {
      if (data !== undefined) passed.push(data);
      return (add as (...args: unknown[]) => unknown)(component, target, data);
    },
    configurable: true,
  });

  commands.add(point, entity, { x: 7, y: 2 });
  commands.add(point, entity, { x: "eight" } as never);
  assertStrictEquals(commands.pendingCount, 2, "non-numeric values are not validated when queued");
  assertThrows(() => commands.flush(), ComponentDataError, "point");
  assertEquals(world.components.getDataOrThrow(point, entity), { x: 7, y: 2 }, "side value written by the world");
  assertStrictEquals(passed.length, 2, "both commands reached the world");
  assertStrictEquals(passed[1]!["x"], undefined, "the reused data object releases side values after flush");

  const spawned = commands.spawn([[point, { x: 3 }]]);
  commands.add(point, spawned, { x: 4 });
  commands.flush();
  const owners = Array.from(world.components.getOwners(point))!;
  assertEquals(world.components.getDataOrThrow(point, owners[owners.length - 1]!), { x: 4, y: 0 }, "spawn path");
  await world.destroy();
});

Deno.test("command buffer x field types: every field kind applies at flush", async () => {
  const world = await createTestWorld(fieldComponents);
  const commands = new CommandBuffer(world);
  const other = world.entities.createOrThrow();
  const entity = world.entities.createOrThrow();
  const mesh = new Mesh([3]);
  commands.add(unit, entity, { hp: 4, alive: true, state: "run", target: other, label: "x", mesh });
  commands.flush();
  const data = world.components.getDataOrThrow(unit, entity);
  assertEquals(
    { ...data, mesh: undefined },
    { hp: 4, alive: true, state: "run", target: other, label: "x", mesh: undefined },
    "Every field written",
  );
  assertStrictEquals(data.mesh, mesh, "Object fields are passed by reference");
  commands.set(unit, entity, { label: "y", alive: false });
  commands.flush();
  assertEquals(world.components.getDataOrThrow(unit, entity).label, "y", "set applies side fields");
  assertEquals(world.components.getDataOrThrow(unit, entity).alive, false, "set applies bool fields");
});

Deno.test("command buffer x field types: an entity ref whose target died before flush is written as null", async () => {
  const world = await createTestWorld(fieldComponents);
  const commands = new CommandBuffer(world);
  const target = world.entities.createOrThrow();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  commands.add(unit, a, { hp: 1, target });
  commands.destroy(target);
  commands.add(unit, b, { hp: 2, target });
  commands.flush(); // must not throw
  assertEquals(
    world.components.getDataOrThrow(unit, a).target,
    null,
    "Ref killed later in the same flush reads null",
  );
  assertEquals(world.components.getDataOrThrow(unit, b), {
    hp: 2,
    alive: false,
    state: "idle",
    target: null,
    label: "",
    mesh: null,
  }, "Dead target written as null; the rest of the payload applies");
  // Direct guarded writes still reject dead handles.
  assertThrows(() => world.components.setData(unit, a, { target }), EntityNotFoundError, "");
});

Deno.test("command buffer x field types: a bad field value drains the queue, then rethrows", async () => {
  const world = await createTestWorld(fieldComponents);
  const commands = new CommandBuffer(world);
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  commands.add(unit, a, { state: "fly" as "idle" });
  commands.add(unit, b, { label: "ok" });
  assertThrows(() => commands.flush(), ComponentDataError, "unit");
  assertEquals(world.components.has(unit, a), false, "Failed command left its entity unchanged");
  assertEquals(world.components.getDataOrThrow(unit, b).label, "ok", "Later commands still applied");
  assertStrictEquals(commands.pendingCount, 0, "Queue drained");
});

Deno.test("command buffer x prefabs: spawned bundles and prefab instances agree on field defaults", async () => {
  const world = await createTestWorld(fieldComponents);
  const commands = new CommandBuffer(world);
  const prefab = new Prefab({ components: [[unit, { hp: 5, label: "p" }]] });
  commands.spawn([[unit, { hp: 5, label: "p" }]]);
  commands.flush();
  const spawned = Array.from(world.components.getOwners(unit))![0]!;
  const instance = world.entities.instantiateOrThrow(prefab);
  assertEquals(
    world.components.getDataOrThrow(unit, spawned),
    world.components.getDataOrThrow(unit, instance),
    "Same values either way",
  );
});

Deno.test("command buffer instantiate creates prefab instances at flush, in queue order, like the direct call", async () => {
  const { world, commands } = await setup();
  const mover = new Prefab({ name: "mover", components: [[position, { x: 1, y: 2 }], [tag]] });
  const first = commands.spawn([[velocity, { x: 9 }]]);
  const instance = commands.instantiate(mover, [[position, { y: 5 }], [velocity, { x: 3 }]]);
  commands.instantiate(mover);
  commands.set(position, instance, { x: 4 });
  assert((instance as number) < 0 && instance !== first, "instantiate returns a fresh pending handle");
  assertStrictEquals(commands.pendingCount, 4, "three spawns and a set queued");
  assertStrictEquals(world.entities.getActiveCount(), 0, "nothing created before flush");
  commands.flush();
  const created = Array.from(world.entities.getActive());
  assertStrictEquals(created.length, 3, "every spawn and instance applied");
  const [, made, bare] = created as [Entity, Entity, Entity];
  assertEquals(world.components.getDataOrThrow(position, made), { x: 4, y: 5 }, "overrides, then the set");
  assertEquals(world.components.getDataOrThrow(velocity, made), { x: 3, y: 0 }, "an extra component");
  assert(world.components.has(tag, made) && world.components.has(tag, bare), "prefab tags applied");
  assertEquals(world.components.getDataOrThrow(position, bare), { x: 1, y: 2 }, "prefab defaults");
  const direct = world.entities.instantiateOrThrow(mover, [[position, { y: 5 }], [velocity, { x: 3 }]]);
  assertEquals(
    world.components.getDataOrThrow(velocity, direct),
    world.components.getDataOrThrow(velocity, made),
    "the buffered and direct instances agree",
  );
  await world.destroy();
});

Deno.test("command buffer instantiate merges partial overrides of wide components over prefab defaults", async () => {
  for (const count of [31, 32, 40]) {
    const wide = wideComponent(`wide${count}`, count);
    const world = await createTestWorld([wide], 8);
    const commands = new CommandBuffer(world);
    const prefab = new Prefab({ name: `wide${count}`, components: [[wide, { f0: 7, f1: 8 }]] });
    commands.instantiate(prefab, [[wide, { f2: 1 }]]);
    commands.flush();
    const [buffered] = Array.from(world.entities.getActive()) as [Entity];
    const direct = world.entities.instantiateOrThrow(prefab, [[wide, { f2: 1 }]]);
    assertEquals(world.components.getDataOrThrow(wide, buffered), fields(count, { 0: 7, 1: 8, 2: 1 }), "defaults kept");
    assertEquals(
      world.components.getDataOrThrow(wide, buffered),
      world.components.getDataOrThrow(wide, direct),
      `buffered and direct agree for ${count} fields`,
    );
    await world.destroy();
  }
});

Deno.test("command buffer instantiate validates the prefab and overrides when queued", async () => {
  const { world, commands } = await setup();
  const stray = new Prefab({ name: "stray", components: [[position], [unregistered]] });
  const mover = new Prefab({ name: "mover", components: [[position]] });
  assertThrows(() => commands.instantiate({} as Prefab), ArgumentError, "Prefab");
  assertThrows(() => commands.instantiate(stray), NotRegisteredError, "unregistered");
  assertThrows(() => commands.instantiate(mover, [[position], [position]] as never), ArgumentError, "position");
  assertThrows(() => commands.instantiate(mover, [[position, { z: 1 } as never]]), ComponentDataError, "z");
  assertThrows(() => commands.instantiate(mover, [[unregistered]]), NotRegisteredError, "unregistered");
  assertStrictEquals(commands.pendingCount, 0, "rejected calls queue nothing");
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 0, "nothing created");
  await world.destroy();
});

Deno.test("command buffer instantiate reports capacity like spawn", async () => {
  const { world, commands } = await setup(8);
  const mover = new Prefab({ name: "mover", components: [[position]] });
  for (let i = 0; i < 8; i++) commands.instantiate(mover);
  assertThrows(() => commands.instantiate(mover), CapacityError, "capacity");
  commands.flush();
  assertStrictEquals(world.entities.getActiveCount(), 8, "world full");
  commands.instantiate(mover);
  assertThrows(() => commands.flush(), CapacityError, "instantiate mover");
  await world.destroy();
});
