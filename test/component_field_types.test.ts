/// <reference lib="deno.ns" />

// deno-lint-ignore-file no-await-in-loop -- worlds are built and checked one after another on purpose

import {
  CapacityError,
  cloneFieldValue,
  compileComponentSchema,
  Component,
  ComponentDataError,
  componentSchemaHash,
  createEcsWorld,
  type Entity,
  entityIndex,
  EntityNotFoundError,
  field,
  isFieldDescriptor,
  Prefab,
  Query,
  SpecError,
  System,
  WorldRollbackScope,
} from "../mod.ts";
import { isValidComponentSpec } from "../src/component/component.ts";
import { ComponentManager } from "../src/component/component-manager.ts";
import { type WorldSaveHost, worldSaveHost } from "../src/serialization/host.ts";
import { createEntity, createTestWorld, Mesh } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids } from "./helpers.ts";

// deno-lint-ignore explicit-function-return-type -- the inferred component types are the point of this factory
function unitComponent(maxOwners?: number, create?: () => Mesh, clone?: (mesh: Mesh) => Mesh) {
  const mesh = create === undefined && clone === undefined ?
    field.object<Mesh>() :
    field.object<Mesh>({ ...(create ? { create } : {}), ...(clone ? { clone } : {}) });
  return new Component({
    name: "unit",
    schema: {
      hp: Uint16Array,
      alive: field.bool(),
      state: field.enum(["idle", "run", "dead"]),
      target: field.entity(),
      label: field.string(),
      mesh,
    },
    maxOwners,
  });
}

const DEFAULTS = {
  hp: 0,
  alive: false,
  state: "idle" as "idle" | "run" | "dead",
  target: null as Entity | null,
  label: "",
  mesh: null as Mesh | null,
};

// ---------------------------------------------------------------------------
// Schema, descriptors and hashes
// ---------------------------------------------------------------------------

Deno.test("existing numeric schema hashes are unchanged by field types", () => {
  assertStrictEquals(
    componentSchemaHash(
      {
        Position: { x: Float32Array, y: Float32Array },
        Health: { hp: Uint16Array, maxHp: Uint16Array },
        Flags: {
          a: Int8Array,
          b: Int16Array,
          c: Int32Array,
          d: Uint32Array,
          e: Float64Array,
          f: Uint8ClampedArray,
          g: Uint8Array,
        },
      },
      { Player: true, Hero: { maxOwners: 1 } },
    ),
    "9cb8dc9a1cad8884",
    "Every numeric tag keeps its hash",
  );
  assertStrictEquals(
    compileComponentSchema({ Position: { x: Float32Array } }).schemaHash,
    "7713b3e96ed2bfa4",
    "Single-column hash is stable",
  );
});

Deno.test("field descriptors are frozen, branded and carry stable hash tags", () => {
  const descriptors = [field.bool(), field.enum(["a", "b"]), field.entity(), field.string(), field.object()];
  for (const descriptor of descriptors) {
    assert(Object.isFrozen(descriptor), `${descriptor.kind} descriptor is frozen`);
    assert(isFieldDescriptor(descriptor), `${descriptor.kind} descriptor is branded`);
  }
  assert(!isFieldDescriptor({ kind: "bool" }), "Look-alike objects are not descriptors");
  assert(!isFieldDescriptor(Float32Array), "Typed-array constructors are not descriptors");

  const compiled = compileComponentSchema({
    c: {
      b: field.bool(),
      e: field.enum(["idle", "run"]),
      n: field.entity(),
      s: field.string(),
      o: field.object(),
      x: Float32Array,
    },
  });
  assertEquals(
    compiled.entries[0]!.properties.map((property) => [property.name, property.tag]),
    [["b", "bool"], ["e", 'enum:["idle","run"]'], ["n", "entity"], ["o", "object"], ["s", "string"], ["x", "f32"]],
    "Field tags are canonical",
  );

  const hashOf = (value: unknown): string => componentSchemaHash({ c: { v: value } } as never);
  const tags = new Set([
    hashOf(Uint8Array),
    hashOf(field.bool()),
    hashOf(field.enum(["a", "b"])),
    hashOf(field.enum(["b", "a"])),
    hashOf(field.enum(["a", "b", "c"])),
    hashOf(field.entity()),
    hashOf(field.string()),
    hashOf(field.object()),
  ]);
  assertStrictEquals(tags.size, 8, "Every field kind and enum label list hashes distinctly");
  assertStrictEquals(hashOf(field.enum(["a", "b"])), hashOf(field.enum(["a", "b"])), "Enum hash is deterministic");
  const codec = field.object<Mesh>({ encode: (m) => m.vertices.join(","), decode: (e) => new Mesh([Number(e)]) });
  assert(typeof codec.encode === "function" && typeof codec.decode === "function", "Codec hooks are reachable");
  assertStrictEquals(hashOf(codec), hashOf(field.object()), "Codec hooks are not part of the hash");
  assertStrictEquals(
    hashOf(field.object({ create: () => 1 })),
    hashOf(field.object()),
    "Object hooks are not part of the hash",
  );
});

Deno.test("invalid field declarations are rejected", () => {
  assertThrows(() => field.enum([]), SpecError, "at least one label");
  assertThrows(() => field.enum(["a", "a"]), SpecError, "duplicate");
  assertThrows(() => field.enum([1 as unknown as string]), SpecError, "string");
  assertThrows(() => field.enum(Array.from({ length: 65_537 }, (_, i) => `l${i}`)), SpecError, "65536");
  assertThrows(() => field.object({ create: 1 as never }), SpecError, "create");
  assertThrows(() => field.object({ clone: "x" as never }), SpecError, "clone");
  assertThrows(() => field.object({ encode: 1 as never, decode: () => 1 }), SpecError, "encode");
  assertThrows(() => field.object({ encode: () => 1 }), SpecError, "both encode and decode");
  for (const key of ["entity", "slot"]) {
    assertThrows(
      () => new Component({ name: "c", schema: { [key]: field.bool() } }),
      SpecError,
      "Invalid component specification",
    );
  }
  assertThrows(
    () => new Component({ name: "c", schema: { v: { kind: "bool" } } as never }),
    SpecError,
    "Invalid component specification",
  );
  assert(isValidComponentSpec({ name: "c", schema: { v: field.string() } }), "Side-only schemas are valid");
});

Deno.test("components expose the logical schema and are not tags", () => {
  const enumField = field.enum(["a", "b"]);
  const meshOnly = new Component({ name: "meshOnly", schema: { mesh: field.object<Mesh>() } });
  const mixed = new Component({ name: "mixed", schema: { x: Float32Array, kind: enumField } });
  assert(!meshOnly.isTag, "Side-only components carry data");
  assertStrictEquals(meshOnly.schema!.mesh, meshOnly.schema!.mesh, "Schema is stable");
  assert(isFieldDescriptor(meshOnly.schema!.mesh), "Schema keeps the descriptor");
  assertStrictEquals(mixed.schema!.kind, enumField, "Schema returns the declared descriptor");
  assertStrictEquals(mixed.schema!.x, Float32Array, "Numeric columns are untouched");
});

// ---------------------------------------------------------------------------
// Storage layout and defaults
// ---------------------------------------------------------------------------

Deno.test("field columns have the documented raw layout", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit]);
  const partitions = world.components.getInstanceOrThrow(unit).storage.partitions;
  assert(partitions.alive instanceof Uint8Array, "bool is a Uint8Array");
  assert(partitions.state instanceof Uint8Array, "small enum is a Uint8Array");
  assert(partitions.target instanceof Int32Array, "entity is an Int32Array");
  assert(Array.isArray(partitions.label), "string is a JS array");
  assert(Array.isArray(partitions.mesh), "object is a JS array");
  assertStrictEquals(partitions.label.length, 8, "Side columns are capacity-length");

  const big = new Component({
    name: "big",
    schema: { e: field.enum(Array.from({ length: 300 }, (_, i) => `l${i}`)) },
  });
  const bigWorld = await createTestWorld([big]);
  assert(
    bigWorld.components.getInstanceOrThrow(big).storage.partitions.e instanceof Uint16Array,
    "Large enum is a Uint16Array",
  );
});

Deno.test("new ownership initializes every field to its default, dense and capped", async () => {
  for (const maxOwners of [undefined, 4]) {
    const unit = unitComponent(maxOwners);
    const world = await createTestWorld([unit]);
    const instance = world.components.getInstanceOrThrow(unit);
    const bundled = world.entities.createOrThrow([[unit]]);
    const single = createEntity(world);
    world.components.add(unit, single);
    const batched = createEntity(world);
    world.components.addMany(unit, { count: 1, entities: [batched], slots: [entityIndex(batched)] });
    const partial = world.entities.createOrThrow([[unit, { hp: 5 }]]);
    for (const entity of [bundled, single, batched]) {
      assertEquals(world.components.getDataOrThrow(unit, entity), DEFAULTS, "Defaults on attach");
      assertStrictEquals(instance.storage.partitions.target[entityIndex(entity)], -1, "Raw null ref is -1");
    }
    assertEquals(
      world.components.getDataOrThrow(unit, partial),
      { ...DEFAULTS, hp: 5 },
      "Partial payload defaults",
    );

    world.components.setData(unit, single, {
      alive: true,
      state: "run",
      target: bundled,
      label: "hi",
      mesh: new Mesh(),
    });
    world.components.remove(unit, single);
    world.components.add(unit, single);
    assertEquals(
      world.components.getDataOrThrow(unit, single),
      DEFAULTS,
      `Reacquired row resets (cap ${maxOwners})`,
    );
  }
});

Deno.test("object create() runs once per new owner and never on update", async () => {
  let created = 0;
  const unit = unitComponent(undefined, () => new Mesh([created++]));
  const world = await createTestWorld([unit]);
  const a = world.entities.createOrThrow([[unit]]);
  const b = world.entities.createOrThrow([[unit, { hp: 1 }]]);
  const given = new Mesh([42]);
  const c = world.entities.createOrThrow([[unit, { mesh: given }]]);
  assertStrictEquals(created, 2, "create() runs only for owners without a provided value");
  const meshA = world.components.getDataOrThrow(unit, a).mesh;
  const meshB = world.components.getDataOrThrow(unit, b).mesh;
  assert(meshA instanceof Mesh && meshB instanceof Mesh && meshA !== meshB, "Each owner gets its own object");
  assertStrictEquals(
    world.components.getDataOrThrow(unit, c).mesh,
    given,
    "Provided objects are stored by reference",
  );
  world.components.setData(unit, a, { hp: 2 });
  world.components.add(unit, a, { hp: 3 });
  assertStrictEquals(created, 2, "Updates of existing owners never call create()");
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

Deno.test("guarded writes validate every field kind before any mutation", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit]);
  const entity = world.entities.createOrThrow([[unit, { label: "keep" }]]);
  const dead = createEntity(world);
  world.entities.destroy(dead);

  const bad: [Record<string, unknown>, new (...args: never[]) => Error, string][] = [
    [{ alive: 1 }, ComponentDataError, "boolean"],
    [{ state: "fly" }, ComponentDataError, "label"],
    [{ state: 0 }, ComponentDataError, "label"],
    [{ target: 1.5 }, ComponentDataError, "entity"],
    [{ target: "x" }, ComponentDataError, "entity"],
    [{ target: dead }, EntityNotFoundError, "not active"],
    [{ label: 1 }, ComponentDataError, "string"],
    [{ mesh: undefined }, ComponentDataError, "undefined"],
    [{ hp: Number.NaN }, ComponentDataError, "finite"],
  ];
  for (const [data, ErrorClass, message] of bad) {
    assertThrows(() => world.components.setData(unit, entity, data as never), ErrorClass as never, message);
    assertThrows(
      () => world.components.setData(unit, entity, { label: "changed", ...data } as never),
      ErrorClass as never,
      message,
    );
    assertStrictEquals(
      world.components.getDataOrThrow(unit, entity).label,
      "keep",
      "Failed writes change nothing",
    );
    const before = world.entities.getActiveCount();
    assertThrows(() => world.entities.createOrThrow([[unit, data as never]]), ErrorClass as never, message);
    assertStrictEquals(world.entities.getActiveCount(), before, "Failed spawns allocate nothing");
  }
  world.components.setData(unit, entity, { target: null, mesh: null });
});

Deno.test("guarded writes accept every valid field value", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit]);
  const target = createEntity(world);
  const entity = world.entities.createOrThrow([[unit]]);
  const mesh = new Mesh([1, 2, 3]);
  world.components.setData(unit, entity, {
    hp: 7,
    alive: true,
    state: "dead",
    target,
    label: "orc",
    mesh,
  });
  assertEquals(
    world.components.getDataOrThrow(unit, entity),
    { hp: 7, alive: true, state: "dead", target, label: "orc", mesh },
    "Values round-trip",
  );
  assertStrictEquals(world.components.getDataOrThrow(unit, entity).mesh, mesh, "Object stored by reference");
  world.components.setData(unit, entity, { target: entity }); // self-reference is a live entity
  assertStrictEquals(world.components.getDataOrThrow(unit, entity).target, entity, "Self references are allowed");
  const partitions = world.components.getInstanceOrThrow(unit).storage.partitions;
  const slot = entityIndex(entity);
  assertStrictEquals(partitions.alive[slot], 1, "bool stored as 1");
  assertStrictEquals(partitions.state[slot], 2, "enum stored as index");
  assertStrictEquals(partitions.label[slot], "orc", "string stored as is");
});

// ---------------------------------------------------------------------------
// Proxy, instance and read APIs
// ---------------------------------------------------------------------------

Deno.test("proxy and instance get/set decode and validate field values", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit]);
  const target = createEntity(world);
  const entity = world.entities.createOrThrow([[unit]]);
  const instance = world.components.getInstanceOrThrow(unit);
  const proxy = instance.proxy;
  world.refresh();

  proxy.entity = entity;
  assertStrictEquals(proxy.alive, false, "Proxy reads boolean");
  assertStrictEquals(proxy.state, "idle", "Proxy reads label");
  assertStrictEquals(proxy.target, null, "Proxy reads null ref");
  assertStrictEquals(proxy.label, "", "Proxy reads string");
  assertStrictEquals(proxy.mesh, null, "Proxy reads object");

  proxy.alive = false;
  proxy.state = "idle";
  proxy.label = "";
  proxy.mesh = null;
  proxy.target = null;
  assertEquals(ids(world.components.getChanged(unit)), [], "Writing the current value is not a change");

  proxy.state = "run";
  assertEquals(ids(world.components.getChanged(unit)), [entity], "A real write marks changed");
  world.refresh();
  const mesh = new Mesh();
  proxy.mesh = mesh;
  assertEquals(ids(world.components.getChanged(unit)), [entity], "Object writes mark changed");
  world.refresh();
  proxy.mesh = mesh;
  assertEquals(ids(world.components.getChanged(unit)), [], "Same reference is not a change");

  assertThrows(() => (proxy.alive = 1 as never), ComponentDataError, "boolean");
  assertThrows(() => (proxy.state = "fly" as never), ComponentDataError, "label");
  assertThrows(() => (proxy.label = 3 as never), ComponentDataError, "string");
  assertThrows(() => (proxy.mesh = undefined as never), ComponentDataError, "undefined");

  instance.set(entity, "target", target);
  assertStrictEquals(instance.get(entity, "target"), target, "instance.get decodes refs");
  instance.set(entity, "alive", true);
  assertStrictEquals(instance.get(entity, "alive"), true, "instance.get decodes bools");
  assertStrictEquals(instance.get(entity, "state"), "run", "instance.get decodes labels");
  assertStrictEquals(instance.get(entity, "mesh"), mesh, "instance.get returns object refs");

  const out = {
    hp: -1,
    alive: false,
    state: "idle" as "idle" | "run" | "dead",
    target: null as Entity | null,
    label: "",
    mesh: null as Mesh | null,
  };
  assert(world.components.readDataInto(unit, entity, out), "readDataInto reads owners");
  assertEquals(out, { hp: 0, alive: true, state: "run", target, label: "", mesh }, "readDataInto decodes");
  assertStrictEquals(out.mesh, mesh, "readDataInto copies refs");
  assertEquals(world.components.getData(unit, entity), out, "getData decodes");
});

Deno.test("entity refs read as null once the target is destroyed or its slot reused", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit], 8);
  const target = createEntity(world);
  const entity = world.entities.createOrThrow([[unit, { target }]]);
  const instance = world.components.getInstanceOrThrow(unit);
  assertStrictEquals(instance.get(entity, "target"), target, "Live ref reads the handle");
  world.entities.destroy(target);
  assertStrictEquals(instance.get(entity, "target"), null, "Destroyed target reads null");
  assertStrictEquals(instance.storage.partitions.target[entityIndex(entity)], target, "Raw column keeps the handle");
  // Reuse the slot under a new generation: the stale handle still reads null.
  const reused: Entity[] = [];
  for (let i = 0; i < 7; i++) {
    const created = world.entities.create();
    if (created !== undefined) reused.push(created);
  }
  assert(reused.some((e) => entityIndex(e) === entityIndex(target)), "Target slot was reused");
  assertStrictEquals(
    world.components.getDataOrThrow(unit, entity).target,
    null,
    "Reused slot does not revive the ref",
  );
  instance.proxy.entity = entity;
  assertStrictEquals(instance.proxy.target, null, "Proxy agrees");
  assertThrows(() => (instance.proxy.target = target), EntityNotFoundError, "not active");
});

// ---------------------------------------------------------------------------
// Ownership loss releases object and string references
// ---------------------------------------------------------------------------

Deno.test("removing a component or destroying its owner releases side-column references", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit]);
  const partitions = world.components.getInstanceOrThrow(unit).storage.partitions;
  const removed = world.entities.createOrThrow([[unit, { mesh: new Mesh(), label: "a" }]]);
  const destroyed = world.entities.createOrThrow([[unit, { mesh: new Mesh(), label: "b" }]]);
  const batch = world.entities.createOrThrow([[unit, { mesh: new Mesh(), label: "c" }]]);
  world.components.remove(unit, removed);
  world.entities.destroy(destroyed);
  world.components.removeMany(unit, { count: 1, entities: [batch], slots: [entityIndex(batch)] });
  for (const entity of [removed, destroyed, batch]) {
    assertStrictEquals(partitions.mesh[entityIndex(entity)], null, "Object cell released");
    assertStrictEquals(partitions.label[entityIndex(entity)], "", "String cell released");
  }
});

// ---------------------------------------------------------------------------
// Rollback and checkpoints
// ---------------------------------------------------------------------------

Deno.test("rollback restores every field kind for dense and capped components", async () => {
  for (const maxOwners of [undefined, 3]) {
    const unit = unitComponent(maxOwners);
    const world = await createTestWorld([unit]);
    const target = createEntity(world);
    const meshA = new Mesh([1]);
    const a = world.entities.createOrThrow([[unit, {
      hp: 1,
      alive: true,
      state: "run",
      target,
      label: "a",
      mesh: meshA,
    }]]);
    const b = world.entities.createOrThrow([[unit, { label: "b" }]]);
    const before = [world.components.getDataOrThrow(unit, a), world.components.getDataOrThrow(unit, b)];

    const point = new WorldRollbackScope(world);
    world.components.setData(unit, a, { alive: false, state: "dead", target: null, label: "z", mesh: null });
    world.components.remove(unit, b);
    const spec = world.entities.createOrThrow([[unit, { mesh: new Mesh([9]), label: "spec" }]]);
    const specSlot = entityIndex(spec);
    meshA.vertices.push(2); // in-place mutation is not undone without a clone hook
    point.restore();

    assertEquals(world.components.getDataOrThrow(unit, a), before[0], `Row a restored (cap ${maxOwners})`);
    assertStrictEquals(world.components.getDataOrThrow(unit, a).mesh, meshA, "Same reference restored");
    assertEquals(meshA.vertices, [1, 2], "Reference semantics: inner mutation persists");
    assertEquals(world.components.getDataOrThrow(unit, b), before[1], "Removed row restored");
    const partitions = world.components.getInstanceOrThrow(unit).storage.partitions;
    assertStrictEquals(partitions.mesh[specSlot], null, "Speculative owner's object released on restore");
    assertStrictEquals(partitions.label[specSlot], "", "Speculative owner's string released on restore");
  }
});

Deno.test("object clone hooks give rollback and checkpoints value semantics", async () => {
  let clones = 0;
  const clone = (mesh: Mesh): Mesh => {
    clones++;
    return new Mesh([...mesh.vertices]);
  };
  const unit = unitComponent(undefined, undefined, clone);
  const world = await createTestWorld([unit]);
  const mesh = new Mesh([1]);
  const entity = world.entities.createOrThrow([[unit, { mesh }]]);

  const point = new WorldRollbackScope(world);
  assertStrictEquals(clones, 1, "Capture clones owned object cells once");
  mesh.vertices.push(2);
  point.restore();
  const restored = world.components.getDataOrThrow(unit, entity).mesh!;
  assert(restored !== mesh, "Restore installs the captured clone");
  assertEquals(restored.vertices, [1], "Inner mutation is undone");
  assertStrictEquals(clones, 1, "Restore does not clone again");

  const committed = new WorldRollbackScope(world);
  committed.commit();

  clones = 0;
  const checkpoint = world.captureCheckpoint([entity], unit);
  assertStrictEquals(clones, 1, "Checkpoint capture clones");
  restored.vertices.push(5);
  world.applyCheckpoint(checkpoint);
  const first = world.components.getDataOrThrow(unit, entity).mesh!;
  assertEquals(first.vertices, [1], "Checkpoint restores the captured value");
  first.vertices.push(6);
  world.applyCheckpoint(checkpoint);
  const second = world.components.getDataOrThrow(unit, entity).mesh!;
  assert(second !== first, "Each apply installs a fresh clone");
  assertEquals(second.vertices, [1], "A reused checkpoint is not corrupted by later mutation");
});

Deno.test("checkpoints round-trip every field kind and restore dead refs as null", async () => {
  const unit = unitComponent();
  const world = await createTestWorld([unit]);
  const target = createEntity(world);
  const mesh = new Mesh();
  const entity = world.entities.createOrThrow([[unit, {
    hp: 2,
    alive: true,
    state: "dead",
    target,
    label: "x",
    mesh,
  }]]);
  const checkpoint = world.captureCheckpoint([entity], unit);
  world.components.setData(unit, entity, { alive: false, state: "idle", label: "y", mesh: null, target: null });
  world.applyCheckpoint(checkpoint);
  assertEquals(
    world.components.getDataOrThrow(unit, entity),
    { hp: 2, alive: true, state: "dead", target, label: "x", mesh },
    "Checkpoint restores decoded values",
  );
  world.entities.destroy(target);
  world.components.setData(unit, entity, { label: "z" });
  world.applyCheckpoint(checkpoint); // must not throw for the now-dead target
  assertStrictEquals(world.components.getDataOrThrow(unit, entity).target, null, "Dead ref restores as null");
  assertStrictEquals(world.components.getDataOrThrow(unit, entity).label, "x", "Other fields restored");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Deno.test("staged side values are released after single writes and shared across batch writes", async () => {
  const unit = unitComponent();
  const manager = new ComponentManager(8, [unit]);
  const instance = manager.getInstanceOrThrow(unit);
  const scratch = (manager.saveStates[0] as unknown as { sideScratch: unknown[] }).sideScratch;
  const staged = (): boolean => scratch.some((value) => value !== undefined);
  const mesh = new Mesh([1]);

  manager.addInstanceToEntity(instance, 0 as Entity, { label: "a", mesh } as never);
  assert(!staged(), "A single validated add releases its staged values");
  manager.setInstanceEntityData(instance, 0 as Entity, { mesh: new Mesh([2]) } as never);
  assert(!staged(), "setInstanceEntityData releases its staged values");

  // Batch paths stage once and write many rows; the values must survive until released.
  manager.validateInstanceData(instance, { label: "b", mesh });
  manager.addInstanceToEntity(instance, 1 as Entity, { label: "b", mesh } as never, 1, true);
  manager.addInstanceToEntity(instance, 2 as Entity, { label: "b", mesh } as never, 2, true);
  assertStrictEquals(manager.getInstanceEntityData(instance, 2 as Entity)!.mesh, mesh, "Second batch row is written");
  assert(staged(), "Batch staging survives between rows");
  manager.releaseStagedData(instance.id);
  assert(!staged(), "releaseStagedData drops staged values");
  manager.validateInstanceData(instance, { mesh });
  manager.refresh();
  assert(!staged(), "refresh drops staged values");

  const world = await createTestWorld([unit]);
  const entities = [createEntity(world), createEntity(world), createEntity(world)];
  world.components.addMany(unit, {
    count: entities.length,
    entities,
    slots: entities.map((entity) => entityIndex(entity)),
  }, { label: "many", mesh });
  for (const entity of entities) {
    const data = world.components.getDataOrThrow(unit, entity);
    assertStrictEquals(data.mesh, mesh, "Every batched owner gets the object");
    assertStrictEquals(data.label, "many", "Every batched owner gets the string");
  }
});

Deno.test("world write paths release staged side values once committed or discarded", async () => {
  const unit = unitComponent(2);
  const other = new Component({ name: "other", schema: { note: field.string() } });
  const world = await createTestWorld([unit, other]);
  const host = (world as unknown as { [worldSaveHost](): WorldSaveHost })[worldSaveHost]();
  const scratchOf = (index: number): unknown[] =>
    (host.components.saveStates[index] as unknown as { sideScratch: unknown[] }).sideScratch;
  const staged = (): boolean => [0, 1].some((index) => scratchOf(index).some((value) => value !== undefined));
  const mesh = new Mesh([1]);
  const first = createEntity(world);
  const second = createEntity(world);
  const third = createEntity(world);

  world.components.add(unit, first, { label: "a", mesh });
  assert(!staged(), "A world add releases its staged values");

  world.components.addMany(unit, { count: 1, entities: [second], slots: [entityIndex(second)] }, { mesh });
  assert(!staged(), "A batch add releases after its last row");

  assertThrows(() => world.components.add(unit, third, { mesh }), CapacityError, "can only be added");
  assert(!staged(), "An add rejected by the owner cap releases its staged values");

  assertThrows(
    () => world.components.addMany(unit, { count: 1, entities: [999 as Entity], slots: [999] }, { mesh }),
    EntityNotFoundError,
    "",
  );
  assert(!staged(), "A batch rejected before its first row releases its staged values");

  assertThrows(
    () => world.components.add(unit, first, { label: "b", mesh: undefined as never }),
    ComponentDataError,
    "cannot be undefined",
  );
  assert(!staged(), "A payload with an invalid side field stages nothing");

  assertThrows(
    () => world.entities.create([[other, { note: "n" }], [unit, { mesh, label: 5 as never }]]),
    ComponentDataError,
    "",
  );
  assert(!staged(), "A bundle that fails validation releases the entries already staged");

  world.entities.create([[other, { note: "n" }]]);
  assert(!staged(), "A committed bundle releases its staged values");

  world.components.remove(unit, second);
  const prefab = new Prefab({ components: [[other]] });
  world.entities.instantiateOrThrow(prefab, [[unit, { mesh }]]);
  assert(!staged(), "A prefab spawn releases its staged overrides");

  const checkpoint = world.captureCheckpoint([first], unit);
  world.applyCheckpoint(checkpoint);
  assert(!staged(), "A checkpoint apply leaves nothing staged");
});

Deno.test("cloneFieldValue applies object clone hooks and passes other values through", () => {
  const mesh = new Mesh([1]);
  const cloned = cloneFieldValue(field.object<Mesh>({ clone: (m) => new Mesh([...m.vertices]) }), mesh);
  assert(cloned !== mesh && cloned instanceof Mesh, "Hook applied");
  assertStrictEquals(cloneFieldValue(field.object<Mesh>(), mesh), mesh, "No hook shares the reference");
  assertStrictEquals(cloneFieldValue(field.object<Mesh>({ clone: () => mesh }), null), null, "null is not cloned");
  assertStrictEquals(cloneFieldValue(field.string(), "s"), "s", "Strings pass through");
  assertStrictEquals(cloneFieldValue(Float32Array, 1.5), 1.5, "Numbers pass through");
});

// ---------------------------------------------------------------------------
// Typed world bootstrap and systems
// ---------------------------------------------------------------------------

Deno.test("createEcsWorld and systems work with field types", async () => {
  const game = createEcsWorld({
    capacity: 16,
    components: {
      Unit: {
        hp: Uint16Array,
        state: field.enum(["idle", "run"]),
        title: field.string(),
        target: field.entity(),
      },
    },
    tags: { Player: true },
  });
  await game.init();
  const a = game.spawnOrThrow({ Unit: { hp: 3, title: "a" }, Player: true });
  const b = game.spawnOrThrow({ Unit: { state: "run", target: a } });
  assertStrictEquals(game.storage.Unit.get(b, "target"), a, "Typed storage reads refs");
  assertStrictEquals(game.storage.Unit.get(a, "title"), "a", "Typed storage reads strings");

  const seen: string[] = [];
  const naming = new System({
    name: "naming",
    query: new Query({ all: { unit: game.components.Unit } }),
    callback: (components, entities) => {
      const { title, state } = components.unit.storage.partitions;
      for (let i = 0; i < entities.count; i++) {
        const slot = entities.slots[i]!;
        seen.push(`${title[slot]}:${state[slot]}`);
      }
    },
  });
  game.world.systems.register(naming)();
  assertEquals(seen.toSorted(), [":1", "a:0"], "Systems read raw side and typed columns");
});
