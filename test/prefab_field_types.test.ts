/// <reference lib="deno.ns" />

import { Component, ComponentDataError, type DynamicComponent, type Entity, field, Prefab } from "../mod.ts";
import { createTestWorld, Mesh } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, listIds } from "./helpers.ts";

let created = 0;
const createMesh = (): Mesh => {
  created++;
  return new Mesh([created]);
};
const cloneMesh = (mesh: Mesh): Mesh => new Mesh([...mesh.vertices]);

const unit = new Component({
  name: "unit",
  schema: {
    hp: Uint16Array,
    alive: field.bool(),
    state: field.enum(["idle", "run", "dead"]),
    target: field.entity(),
    label: field.string(),
  },
});
const created_ = new Component({
  name: "createdMesh",
  schema: { mesh: field.object<Mesh>({ create: createMesh }) },
});
const cloned = new Component({
  name: "clonedMesh",
  schema: { mesh: field.object<Mesh>({ clone: cloneMesh }) },
});
const bare = new Component({
  name: "bareMesh",
  schema: { mesh: field.object<Mesh | number>() },
});

const components: DynamicComponent[] = [unit, created_, cloned, bare];

const UNIT_DEFAULTS = { hp: 0, alive: false, state: "idle" as "idle" | "run" | "dead", target: null, label: "" };

Deno.test("Prefab field defaults: unset fields take each field type's default", async () => {
  const prefab = new Prefab({ components: [[unit, { hp: 3 }]] });
  assertEquals(prefab.get(unit), { ...UNIT_DEFAULTS, hp: 3 }, "Prefab.get fills field defaults");
  const world = await createTestWorld(components);
  const entity = world.entities.instantiateOrThrow(prefab);
  assertEquals(
    world.components.getDataOrThrow(unit, entity),
    { ...UNIT_DEFAULTS, hp: 3 },
    "Instance takes field defaults",
  );
});

Deno.test("Prefab field defaults: bool, enum and string defaults round-trip and match create(bundle)", async () => {
  const data = { hp: 7, alive: true, state: "run", label: "orc" } as const;
  const prefab = new Prefab({ components: [[unit, data]] });
  assertEquals(prefab.get(unit), { ...UNIT_DEFAULTS, ...data }, "Prefab.get returns logical values");
  const world = await createTestWorld(components);
  const a = world.entities.instantiateOrThrow(prefab);
  const b = world.entities.createOrThrow([[unit, data]]);
  assertEquals(
    world.components.getDataOrThrow(unit, a),
    world.components.getDataOrThrow(unit, b),
    "Matches create(bundle)",
  );
  const list = world.entities.instantiateManyOrThrow(prefab, 3);
  for (let i = 0; i < list.count; i++) {
    assertEquals(
      world.components.getDataOrThrow(unit, list.entities[i]! as Entity),
      { ...UNIT_DEFAULTS, ...data },
      "Bulk instance values",
    );
  }
});

Deno.test("Prefab field defaults: invalid field values are rejected at definition", () => {
  assertThrows(
    () => new Prefab({ components: [[unit, { alive: 1 as unknown as boolean }]] }),
    ComponentDataError,
    "boolean",
  );
  assertThrows(() => new Prefab({ components: [[unit, { state: "fly" as "idle" }]] }), ComponentDataError, "enum");
  assertThrows(
    () => new Prefab({ components: [[unit, { label: 5 as unknown as string }]] }),
    ComponentDataError,
    "string",
  );
});

Deno.test("Prefab entity-ref defaults must be null; live targets are instantiate overrides", async () => {
  const world = await createTestWorld(components);
  const other = world.entities.createOrThrow();
  assertThrows(() => new Prefab({ components: [[unit, { target: other }]] }), ComponentDataError, "override");
  const prefab = new Prefab({ components: [[unit, { target: null }]] });
  const entity = world.entities.instantiateOrThrow(prefab, [[unit, { target: other }]]);
  assertEquals(world.components.getDataOrThrow(unit, entity).target, other, "Override target is stored");
  const plain = world.entities.instantiateOrThrow(prefab);
  assertEquals(world.components.getDataOrThrow(unit, plain).target, null, "Default target is null");
});

Deno.test("Prefab object fields: an absent value calls create() once per instance", async () => {
  const prefab = new Prefab({ components: [[created_]] });
  const world = await createTestWorld(components);
  const before = created;
  const list = world.entities.instantiateManyOrThrow(prefab, 3);
  assertEquals(created - before, 3, "create() runs once per instance");
  const meshes = new Set<unknown>();
  for (let i = 0; i < list.count; i++) {
    meshes.add(world.components.getDataOrThrow(created_, list.entities[i]! as Entity).mesh);
  }
  assertEquals(meshes.size, 3, "Each instance owns its own created object");
});

Deno.test("Prefab object fields: a given value is cloned per instance when clone is defined", async () => {
  const template = new Mesh([1, 2, 3]);
  const prefab = new Prefab({ components: [[cloned, { mesh: template }]] });
  const world = await createTestWorld(components);
  const a = world.entities.instantiateOrThrow(prefab);
  const b = world.entities.instantiateOrThrow(prefab);
  const meshA = world.components.getDataOrThrow(cloned, a).mesh!;
  const meshB = world.components.getDataOrThrow(cloned, b).mesh!;
  assert(meshA !== template && meshB !== template && meshA !== meshB, "Instances never share the template object");
  assertEquals(meshA.vertices, [1, 2, 3], "Clone copies the template");
  meshA.vertices.push(4);
  assertEquals(template.vertices, [1, 2, 3], "Mutating an instance leaves the template untouched");
});

Deno.test("Prefab object fields: an object value without clone is rejected at definition", () => {
  assertThrows(() => new Prefab({ components: [[bare, { mesh: new Mesh() }]] }), ComponentDataError, "clone");
  assertThrows(() => new Prefab({ components: [[created_, { mesh: new Mesh() }]] }), ComponentDataError, "clone");
  // Null and primitives cannot be shared mutably, so they are allowed.
  new Prefab({ components: [[bare, { mesh: null }]] });
  new Prefab({ components: [[bare, { mesh: 4 }]] });
});

Deno.test("Prefab object fields: overrides are stored by reference like create(bundle)", async () => {
  const prefab = new Prefab({ components: [[created_]] });
  const world = await createTestWorld(components);
  const given = new Mesh([9]);
  const before = created;
  const entity = world.entities.instantiateOrThrow(prefab, [[created_, { mesh: given }]]);
  assertStrictEquals(
    world.components.getDataOrThrow(created_, entity).mesh,
    given,
    "Override stored by reference",
  );
  assertEquals(created, before, "create() is skipped when an override supplies the value");
});

Deno.test("Prefab object fields: a throwing create() leaves the world unchanged", async () => {
  let fail = false;
  const fragile = new Component({
    name: "fragile",
    schema: {
      mesh: field.object<Mesh>({
        create: () => (fail ?
          (() => {
            throw new Error("boom");
          })() :
          new Mesh()),
      }),
    },
  });
  const world = await createTestWorld([fragile]);
  const prefab = new Prefab({ components: [[fragile]] });
  world.entities.instantiateOrThrow(prefab);
  fail = true;
  assertThrows(() => world.entities.instantiateManyOrThrow(prefab, 2), Error, "boom");
  assertEquals(world.entities.getActiveCount(), 1, "No instance survives a failed bulk call");
  assertEquals(Array.from(world.components.getOwners(fragile))?.length, 1, "No ownership survives a failed bulk call");
});

Deno.test("a create() hook that breaks its contract by instantiating does not corrupt its caller's borrowed list", async () => {
  const inner = new Component({ name: "inner", schema: { x: Uint8Array } });
  const innerPrefab = new Prefab({ components: [[inner]] });
  const host = new Component({
    name: "host",
    schema: {
      mesh: field.object({
        create: () => {
          world.entities.instantiateManyOrThrow(innerPrefab, 2);
          return {};
        },
      }),
    },
  });
  const world = await createTestWorld([inner, host], 16);
  const outer = new Prefab({ components: [[host]] });
  const list = world.entities.instantiateManyOrThrow(outer, 3);
  const entities = listIds(list);
  assertStrictEquals(entities.length, 3, "Outer list holds only its own entities");
  for (const entity of entities) {
    assert(world.components.has(host, entity as Entity), `Outer entity ${entity} has the prefab component`);
  }
});
