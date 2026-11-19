/// <reference lib="deno.ns" />

import { Component, type DynamicComponent, field, Prefab, Relation, SpecError, WorldRollbackScope } from "../mod.ts";
import { createTestWorld } from "./fixtures.ts";
import { assertEquals, assertThrows } from "./helpers.ts";

const childOf = new Relation({ name: "childOf", exclusive: true, acyclic: true, onDeleteTarget: "cascade" });
const likes = new Relation({ name: "likes" });
const unit = new Component({
  name: "unit",
  schema: { hp: Uint16Array, label: field.string(), target: field.entity(), alive: field.bool() },
});

const components: DynamicComponent[] = [childOf, likes, unit];

Deno.test("relations x field types: relation pair data rejects field descriptors", () => {
  assertThrows(() => new Relation({ name: "r", schema: { flag: field.bool() } as never }), SpecError, "numeric");
  assertThrows(() => new Relation({ name: "r", schema: { label: field.string() } as never }), SpecError, "numeric");
});

Deno.test("relations x prefabs: a prefab rejects relation components at definition", () => {
  assertThrows(() => new Prefab({ components: [[childOf]] }), TypeError, "relation");
  const base = new Prefab({ components: [[unit]] });
  assertThrows(() => new Prefab({ extends: base, components: [[likes]] }), TypeError, "relation");
});

Deno.test("relations x prefabs: instantiate overrides reject relation components and change nothing", async () => {
  const world = await createTestWorld(components);
  const prefab = new Prefab({ components: [[unit, { hp: 3 }]] });
  assertThrows(() => world.entities.instantiate(prefab, [[childOf]]), TypeError, "relation");
  assertThrows(() => world.entities.instantiateMany(prefab, 2, [[likes]]), TypeError, "relation");
  assertEquals(world.entities.getActiveCount(), 0, "Rejected overrides allocate nothing");
  // Relations are attached after instantiation, through world.relations.
  const parent = world.entities.createOrThrow();
  const child = world.entities.instantiateOrThrow(prefab);
  world.relations.add(childOf, child, parent);
  assertEquals(world.relations.getTarget(childOf, child), parent, "Pairs attach to prefab instances");
});

Deno.test("relations x field types: one rollback restores side columns and relation pairs together", async () => {
  const world = await createTestWorld(components);
  const parent = world.entities.createWithOrThrow([[unit, { hp: 1, label: "parent" }]]);
  const child = world.entities.createWithOrThrow([[unit, { hp: 2, label: "child", target: parent, alive: true }]]);
  world.relations.add(childOf, child, parent);
  world.refresh();

  const point = new WorldRollbackScope(world);
  world.components.setEntityData(unit, child, { label: "changed", target: null, alive: false });
  world.relations.remove(childOf, child, parent);
  world.relations.add(likes, parent, child);
  world.entities.destroy(parent);
  point.restore();

  assertEquals(
    world.components.getEntityData(unit, child),
    { hp: 2, target: parent, alive: true, label: "child" },
    "Field values restored, including the entity ref to the revived parent",
  );
  assertEquals(world.relations.getTarget(childOf, child), parent, "Relation pair restored");
  assertEquals(world.relations.getTargets(likes, parent).count, 0, "Speculative pair dropped");
  assertEquals(world.components.getEntityData(unit, parent).label, "parent", "Destroyed entity's side cells restored");
});

Deno.test("relations x field types: an entity field reads null after its target dies in a cascade", async () => {
  const world = await createTestWorld(components);
  const root = world.entities.createOrThrow();
  const leaf = world.entities.createOrThrow();
  world.relations.add(childOf, leaf, root);
  const watcher = world.entities.createWithOrThrow([[unit, { target: leaf }]]);
  world.entities.destroy(root);
  world.refresh();
  assertEquals(world.entities.isActive(leaf), false, "Cascade destroyed the child");
  assertEquals(world.components.getEntityData(unit, watcher).target, null, "Ref to the cascaded entity reads null");
});

Deno.test("relations x field types: a checkpoint restores field columns and relation pairs together", async () => {
  const world = await createTestWorld(components);
  const parent = world.entities.createOrThrow();
  const child = world.entities.createWithOrThrow([[unit, { label: "a", target: parent }]]);
  world.relations.add(childOf, child, parent);
  const checkpoint = world.captureCheckpoint([child], unit, childOf);
  world.components.setEntityData(unit, child, { label: "b", target: null });
  world.relations.remove(childOf, child, parent);
  world.applyCheckpoint(checkpoint);
  assertEquals(world.components.getEntityData(unit, child).label, "a", "String field restored");
  assertEquals(world.components.getEntityData(unit, child).target, parent, "Entity field restored");
  assertEquals(world.relations.getTarget(childOf, child), parent, "Relation pair restored");
});
