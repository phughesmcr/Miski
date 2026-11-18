/// <reference lib="deno.ns" />

import {
  CommandBuffer,
  Component,
  ComponentDataError,
  type DynamicComponent,
  EntityNotFoundError,
  field,
  Prefab,
  Relation,
} from "../mod.ts";
import { createTestWorld } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

class Mesh {
  id: number;
  constructor(id = 0) {
    this.id = id;
  }
}

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

const components: DynamicComponent[] = [unit, childOf];

Deno.test("command buffer x field types: every field kind applies at flush", async () => {
  const world = await createTestWorld(components);
  const commands = new CommandBuffer(world);
  const other = world.entities.createOrThrow();
  const entity = world.entities.createOrThrow();
  const mesh = new Mesh(3);
  commands.add(unit, entity, { hp: 4, alive: true, state: "run", target: other, label: "x", mesh });
  commands.flush();
  const data = world.components.getEntityData(unit, entity);
  assertEquals(
    { ...data, mesh: undefined },
    { hp: 4, alive: true, state: "run", target: other, label: "x", mesh: undefined },
    "Every field written",
  );
  assertStrictEquals(data.mesh, mesh, "Object fields are passed by reference");
  commands.set(unit, entity, { label: "y", alive: false });
  commands.flush();
  assertEquals(world.components.getEntityData(unit, entity).label, "y", "set applies side fields");
  assertEquals(world.components.getEntityData(unit, entity).alive, false, "set applies bool fields");
});

Deno.test("command buffer x field types: an entity ref whose target died before flush is written as null", async () => {
  const world = await createTestWorld(components);
  const commands = new CommandBuffer(world);
  const target = world.entities.createOrThrow();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  commands.add(unit, a, { hp: 1, target });
  commands.destroy(target);
  commands.add(unit, b, { hp: 2, target });
  commands.flush(); // must not throw
  assertEquals(world.components.getEntityData(unit, a).target, null, "Ref killed later in the same flush reads null");
  assertEquals(world.components.getEntityData(unit, b), {
    hp: 2,
    alive: false,
    state: "idle",
    target: null,
    label: "",
    mesh: null,
  }, "Dead target written as null; the rest of the payload applies");
  // Direct guarded writes still reject dead handles.
  assertThrows(() => world.components.setEntityData(unit, a, { target }), EntityNotFoundError, "");
});

Deno.test("command buffer x field types: a bad field value drains the queue, then rethrows", async () => {
  const world = await createTestWorld(components);
  const commands = new CommandBuffer(world);
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  commands.add(unit, a, { state: "fly" as "idle" });
  commands.add(unit, b, { label: "ok" });
  assertThrows(() => commands.flush(), ComponentDataError, "unit");
  assertEquals(world.components.entityHas(unit, a), false, "Failed command left its entity unchanged");
  assertEquals(world.components.getEntityData(unit, b).label, "ok", "Later commands still applied");
  assertStrictEquals(commands.pendingCount, 0, "Queue drained");
});

Deno.test("command buffer x relations: relation presence tags are rejected when queued, like direct calls", async () => {
  const world = await createTestWorld(components);
  const commands = new CommandBuffer(world);
  const a = world.entities.createOrThrow();
  assertThrows(() => commands.add(childOf, a), TypeError, "relation");
  commands.add(unit, a, { hp: 9 });
  commands.flush();
  assert(!world.components.entityHas(childOf, a), "Relation tag not added without a pair");
  assertEquals(world.components.getEntityData(unit, a).hp, 9, "Later commands still applied");
});

Deno.test("command buffer x prefabs: spawned bundles and prefab instances agree on field defaults", async () => {
  const world = await createTestWorld(components);
  const commands = new CommandBuffer(world);
  const prefab = new Prefab({ components: [[unit, { hp: 5, label: "p" }]] });
  commands.spawn([[unit, { hp: 5, label: "p" }]]);
  commands.flush();
  const spawned = world.components.getOwnersSnapshot(unit)![0]!;
  const instance = world.entities.instantiateOrThrow(prefab);
  assertEquals(
    world.components.getEntityData(unit, spawned),
    world.components.getEntityData(unit, instance),
    "Same values either way",
  );
});
