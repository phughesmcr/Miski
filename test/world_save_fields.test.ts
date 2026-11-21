/// <reference lib="deno.ns" />

// deno-lint-ignore-file no-await-in-loop -- worlds are built and checked one after another on purpose

/**
 * World saves of `field.*` columns.
 *
 * Bool, enum and entity fields are range-checked on load and recorded as field tags in the layout. Strings are stored
 * as UTF-8 and objects through their `encode` / `decode` hooks. A world loaded from a save must
 * read the same values, keep behaving like the saved world, and re-save to identical bytes. Loads stay
 * validate-then-mutate: every decode hook runs before the world changes.
 */

import {
  Component,
  type DynamicComponent,
  type Entity,
  field,
  loadWorld,
  saveWorld,
  World,
  type WorldSaveDocument,
  WorldSaveError,
  worldSaveFromDocument,
  worldSaveLayout,
  worldSaveToDocument,
} from "../mod.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

class Mesh {
  readonly vertices: number[];
  constructor(vertices: number[]) {
    this.vertices = vertices;
  }
}

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Counts hook calls, and lets a test make decode throw for one encoded value. */
type HookLog = { encoded: number; decoded: number; nullSeen: boolean; poison: string | undefined };

// deno-lint-ignore explicit-function-return-type -- the inferred field descriptor type is the point of this factory
function meshField(log: HookLog) {
  return field.object<Mesh>({
    encode: (mesh) => {
      log.encoded++;
      if (mesh === null) log.nullSeen = true;
      return JSON.stringify(mesh.vertices);
    },
    decode: (encoded) => {
      log.decoded++;
      if (encoded === null) log.nullSeen = true;
      if (encoded === log.poison) throw new Error("bad mesh");
      return new Mesh(JSON.parse(encoded as string) as number[]);
    },
  });
}

/** A numeric value hook: encodes a box as its number, so non-finite numbers and -0 travel through saves. */
const boxed = () =>
  field.object<{ value: number }>({
    encode: (box) => box.value,
    decode: (encoded) => ({ value: encoded as number }),
  });

function components(log: HookLog, cap = 4): DynamicComponent[] {
  return [
    new Component({ name: "pos", schema: { x: Float32Array } }),
    new Component({
      name: "unit",
      schema: {
        hp: Uint16Array,
        label: field.string(),
        alive: field.bool(),
        mesh: meshField(log),
        state: field.enum(["idle", "run"]),
        target: field.entity(),
      },
    }),
    new Component({ name: "named", schema: { text: field.string() } }),
    new Component({ name: "boss", schema: { title: field.string(), box: boxed() }, maxOwners: cap }),
    new Component({ name: "flag" }),
  ];
}

function newLog(): HookLog {
  return { encoded: 0, decoded: 0, nullSeen: false, poison: undefined };
}

async function worldOf(list: DynamicComponent[], capacity = 64): Promise<World> {
  const world = new World({ capacity, components: list });
  await world.init();
  return world;
}

function component(world: World, name: string): DynamicComponent {
  return world.components.getInstance(name)!.type;
}

const TEXTS = [
  "",
  "a",
  "\ufeffbom",
  "hello world",
  "caf\u00e9",
  "\u65e5\u672c\u8a9e",
  "\u{1f600} emoji",
  "x".repeat(300),
  "NaN",
];

/** Populate a world with every field kind, dense and capped, including null objects and freed slots. */
function populate(world: World, random: Rng): Entity[] {
  const live: Entity[] = [];
  const unit = component(world, "unit") as Component<never>;
  const name = component(world, "named") as Component<never>;
  const boss = component(world, "boss") as Component<never>;
  for (let i = 0; i < 40; i++) {
    const e = world.entities.createOrThrow();
    live.push(e);
    const roll = random() % 5;
    if (roll !== 0) {
      world.components.addToEntity(unit, e, {
        hp: random() % 1000,
        label: TEXTS[random() % TEXTS.length],
        alive: (random() & 1) === 1,
        // `0 -` avoids -0, which the JSON mesh hook cannot keep
        mesh: roll === 1 ? null : new Mesh([random() % 9, 0 - (random() % 7), 0.5]),
        state: (random() & 1) === 1 ? "run" : "idle",
        target: live.length > 1 ? live[random() % (live.length - 1)] : null,
      } as never);
    }
    if (roll >= 3) world.components.addToEntity(name, e, { text: TEXTS[random() % TEXTS.length] } as never);
  }
  const values = [1.5, Number.NaN, -0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < 4; i++) {
    world.components.addToEntity(boss, live[i * 3]!, { title: `boss ${i}`, box: { value: values[i]! } } as never);
  }
  // Free a few slots and move ownership around so owner order differs from slot order.
  for (const e of [live[5]!, live[11]!, live[17]!]) world.entities.destroy(e);
  world.components.removeFromEntity(boss, live[3]!);
  world.components.addToEntity(boss, live[20]!, { title: "late", box: { value: values[4]! } } as never);
  return live.filter((e) => world.entities.isActive(e));
}

/** Every owned value of the side-field components, with objects shown through a stable projection. */
function observe(world: World): unknown {
  const out: Record<string, unknown[]> = {};
  for (const name of ["unit", "named", "boss"]) {
    const type = component(world, name);
    const rows: unknown[] = [];
    for (const e of Array.from(world.components.getOwners(type))!) {
      const data = {
        ...(world.components.getEntityDataOrThrow(type as Component<never>, e as Entity) as unknown as object),
      } as Record<string, unknown>;
      if (data["mesh"] instanceof Mesh) data["mesh"] = ["mesh", ...(data["mesh"] as Mesh).vertices];
      const box = data["box"] as { value: number } | undefined;
      if (box !== undefined) data["box"] = Object.is(box.value, -0) ? "-0" : String(box.value);
      rows.push([e, data]);
    }
    out[name] = rows;
  }
  return out;
}

Deno.test("string and object fields round-trip into a fresh world, which re-saves identically", async () => {
  const log = newLog();
  const source = await worldOf(components(log));
  populate(source, rng(1));
  const bytes = saveWorld(source);
  assert(!log.nullSeen, "encode is never called with null");

  const loadLog = newLog();
  const loaded = await worldOf(components(loadLog));
  loadWorld(loaded, bytes);
  assert(!loadLog.nullSeen, "decode is never called with null");
  assert(loadLog.decoded > 0, "decode hooks ran");
  assertEquals(observe(loaded), observe(source), "every string and object value restored");
  assert(bytesEqual(saveWorld(loaded), bytes), "loaded world re-saves to identical bytes");
});

Deno.test("decoded objects are fresh values, and null objects load as null without hook calls", async () => {
  const log = newLog();
  const unitOnly = () => [new Component({ name: "unit", schema: { mesh: meshField(log) } })];
  const source = await worldOf(unitOnly());
  const unit = component(source, "unit") as Component<never>;
  const mesh = new Mesh([1, 2, 3]);
  const a = source.entities.createOrThrow([[unit, { mesh } as never]] as never);
  const b = source.entities.createOrThrow([[unit, { mesh: null } as never]] as never);
  log.encoded = 0;
  const bytes = saveWorld(source);
  assertStrictEquals(log.encoded, 1, "encode runs once per non-null object per save");

  const loaded = await worldOf(unitOnly());
  log.decoded = 0;
  loadWorld(loaded, bytes);
  assertStrictEquals(log.decoded, 1, "decode runs once per non-null object per load");
  const loadedUnit = component(loaded, "unit") as Component<never>;
  const restored = (loaded.components.getEntityDataOrThrow(loadedUnit, a) as { mesh: Mesh }).mesh;
  assert(restored instanceof Mesh && restored !== mesh, "a decoded object is a new instance");
  assertEquals(restored.vertices, [1, 2, 3], "decoded contents");
  assertStrictEquals(
    (loaded.components.getEntityDataOrThrow(loadedUnit, b) as { mesh: unknown }).mesh,
    null,
    "null kept",
  );
});

Deno.test("an encode result of null loads as null", async () => {
  const list = () => [
    new Component({
      name: "maybe",
      schema: { value: field.object<string>({ encode: () => null, decode: () => "never" }) },
    }),
  ];
  const source = await worldOf(list());
  const e = source.entities.createOrThrow([[component(source, "maybe") as Component<never>, {
    value: "dropped",
  } as never]] as never);
  const loaded = await worldOf(list());
  loadWorld(loaded, saveWorld(source));
  assertStrictEquals(
    (loaded.components.getEntityDataOrThrow(component(loaded, "maybe") as Component<never>, e) as { value: unknown })
      .value,
    null,
    "decode is not called for an encoded null",
  );
});

Deno.test("an object field without encode / decode cannot be saved or loaded, naming the field", async () => {
  const list = () => [
    new Component({ name: "pos", schema: { x: Float32Array } }),
    new Component({ name: "meshed", schema: { hp: Uint8Array, mesh: field.object() } }),
  ];
  const world = await worldOf(list());
  const kept = world.entities.createOrThrow();
  const plain = await worldOf([new Component({ name: "pos", schema: { x: Float32Array } })]);
  const bytes = saveWorld(plain);
  const entryPoints: [string, () => unknown][] = [
    ["saveWorld", () => saveWorld(world)],
    ["saveWorld into a buffer", () => saveWorld(world, new Uint8Array(1 << 16))],
    ["worldSaveLayout", () => worldSaveLayout(world)],
    ["loadWorld", () => loadWorld(world, bytes)],
  ];
  for (const [, run] of entryPoints) assertThrows(run, WorldSaveError, "meshed.mesh");
  assert(world.entities.isActive(kept), "rejected calls leave the world untouched");
});

Deno.test("a throwing decode hook leaves the world untouched", async () => {
  const log = newLog();
  const source = await worldOf(components(log));
  populate(source, rng(2));
  const bytes = saveWorld(source);

  const targetLog = newLog();
  const target = await worldOf(components(targetLog));
  populate(target, rng(3));
  const before = saveWorld(target);
  const beforeValues = observe(target);
  targetLog.poison = JSON.stringify(
    (source.components.getEntityDataOrThrow(
      component(source, "unit") as Component<never>,
      Array.from(source.components.getOwners(component(source, "unit")))!.find((e) =>
        (source.components.getEntityDataOrThrow(component(source, "unit") as Component<never>, e as Entity) as {
          mesh: unknown;
        }).mesh !== null
      )! as Entity,
    ) as { mesh: Mesh }).mesh.vertices,
  );
  let error: unknown;
  try {
    loadWorld(target, bytes);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof WorldSaveError && error.message.includes("unit.mesh"), `names the field: ${String(error)}`);
  assert(error.cause instanceof Error && error.cause.message === "bad mesh", "the hook's error is the cause");
  assert(bytesEqual(saveWorld(target), before), "a rejected load leaves the world's state untouched");
  assertEquals(observe(target), beforeValues, "and its object values untouched");
});

Deno.test("invalid encode results and unencodable strings throw before anything is written", async () => {
  const bad: [string, unknown][] = [["undefined", undefined], ["object", {}], ["boolean", true], ["bigint", 1n]];
  for (const [label, result] of bad) {
    const world = await worldOf([
      new Component({
        name: "odd",
        schema: { value: field.object<number>({ encode: () => result as never, decode: () => 0 }) },
      }),
    ]);
    world.entities.createOrThrow([[component(world, "odd") as Component<never>, { value: 1 } as never]] as never);
    assertThrows(() => saveWorld(world), WorldSaveError, "odd.value");
    const target = new Uint8Array(1 << 12).fill(0xaa);
    assertThrows(() => saveWorld(world, target), WorldSaveError, "odd.value");
    assert(target.every((byte) => byte === 0xaa), `${label}: nothing written`);
  }
  const world = await worldOf([new Component({ name: "named", schema: { text: field.string() } })]);
  world.entities.createOrThrow(
    [[component(world, "named") as Component<never>, { text: "ok\ud800" } as never]] as never,
  );
  assertThrows(() => saveWorld(world), WorldSaveError, "named.text");
});

Deno.test("the JSON view round-trips strings and objects losslessly", async () => {
  const log = newLog();
  const source = await worldOf(components(log));
  populate(source, rng(4));
  const bytes = saveWorld(source);
  const document = worldSaveToDocument(bytes);
  const text = JSON.stringify(document);
  const again = worldSaveFromDocument(JSON.parse(text) as WorldSaveDocument);
  assert(bytesEqual(again, bytes), "bytes -> JSON -> bytes is identical");

  const unitDoc = document.components["unit"]!;
  assert(unitDoc.values!["label"]!.every((v) => typeof v === "string"), "strings stay strings");
  const boxes = document.components["boss"]!.values!["box"]!;
  assert(boxes.some((v) => typeof v === "object" && v !== null), "non-finite object numbers are spelled out");
  assert((document.components["unit"]!.values!["mesh"]! as readonly unknown[]).includes(null), "null objects are null");
  assert(document.layout.components[1]!.fields!.some((f) => f.type === "string"), "layout records string fields");
  assert(document.layout.components[1]!.fields!.some((f) => f.type === "object"), "layout records object fields");
});

Deno.test("the JSON view rejects malformed string and object cells", async () => {
  const log = newLog();
  const source = await worldOf(components(log));
  populate(source, rng(5));
  const document = worldSaveToDocument(saveWorld(source));
  const edits: [string, (doc: { components: Record<string, { values: Record<string, unknown[]> }> }) => void][] = [
    ["number in a string field", (doc) => doc.components["unit"]!.values["label"]![0] = 1],
    ["lone surrogate", (doc) => doc.components["unit"]!.values["label"]![0] = "\udc00"],
    ["object cell", (doc) => doc.components["unit"]!.values["mesh"]![0] = { nope: 1 }],
    ["boolean cell", (doc) => doc.components["unit"]!.values["mesh"]![0] = true],
    ["bad number spelling", (doc) => doc.components["boss"]!.values["box"]![0] = { number: "nan" }],
    ["short column", (doc) => doc.components["named"]!.values["text"]!.pop()],
  ];
  for (const [label, edit] of edits) {
    const copy = JSON.parse(JSON.stringify(document));
    edit(copy);
    let rejected = false;
    try {
      worldSaveFromDocument(copy);
    } catch (error) {
      assert(error instanceof WorldSaveError, `${label}: expected WorldSaveError, got ${String(error)}`);
      rejected = true;
    }
    assert(rejected, `${label} is rejected`);
  }
});

Deno.test("corrupt string and object saves throw WorldSaveError and leave the target untouched", async () => {
  const log = newLog();
  const source = await worldOf(components(log), 40);
  populate(source, rng(6));
  const bytes = saveWorld(source);
  const target = await worldOf(components(newLog()), 40);
  populate(target, rng(7));
  const before = saveWorld(target);
  const random = rng(99);
  let rejected = 0;
  for (let trial = 0; trial < 600; trial++) {
    const corrupt = bytes.slice();
    const flips = 1 + (random() % 3);
    // Bias corruption toward the component section, where the string heaps and object cells live.
    for (let i = 0; i < flips; i++) {
      const at = bytes.byteLength - 1 - (random() % Math.floor(bytes.byteLength * 0.6));
      corrupt[at] = random() & 0xff;
    }
    try {
      loadWorld(target, corrupt);
    } catch (error) {
      assert(error instanceof WorldSaveError, `Corruption must throw WorldSaveError, got ${String(error)}`);
      assert(bytesEqual(saveWorld(target), before), `Rejected load mutated the world (trial ${trial})`);
      rejected++;
      continue;
    }
    // An accepted load must leave a world that re-saves and reloads consistently.
    const resaved = saveWorld(target);
    const twin = await worldOf(components(newLog()), 40);
    loadWorld(twin, resaved);
    assertEquals(observe(twin), observe(target), `Accepted corrupt load is inconsistent (trial ${trial})`);
    loadWorld(target, before);
  }
  assert(rejected > 100, `Expected most corruptions to be rejected, got ${rejected}`);
  for (let cut = 0; cut < bytes.byteLength; cut += 8) {
    assertThrows(() => loadWorld(target, bytes.subarray(0, cut)), WorldSaveError, "");
  }
});

Deno.test("a loaded world keeps behaving like the saved one under the same operations", async () => {
  const source = await worldOf(components(newLog()));
  const sourceLive = populate(source, rng(8));
  const loaded = await worldOf(components(newLog()));
  loadWorld(loaded, saveWorld(source));
  const loadedLive = [...sourceLive];
  for (const [world, live] of [[source, sourceLive], [loaded, loadedLive]] as const) {
    const random = rng(9);
    const unit = component(world, "unit") as Component<never>;
    const name = component(world, "named") as Component<never>;
    for (let i = 0; i < 200; i++) {
      const op = random() % 5;
      if (op === 0) {
        live.push(world.entities.createOrThrow());
        continue;
      }
      const e = live[random() % live.length]!;
      if (!world.entities.isActive(e)) continue;
      if (op === 1) world.entities.destroy(e);
      else if (op === 2) world.components.addToEntity(name, e, { text: `n${i}` } as never);
      else if (op === 3) world.components.removeFromEntity(unit, e);
      else if (world.components.entityHas(unit, e)) {
        world.components.setEntityData(unit, e, { label: `l${i}`, mesh: new Mesh([i]) } as never);
      }
    }
  }
  assertEquals(observe(loaded), observe(source), "same values after continued use");
  assert(bytesEqual(saveWorld(loaded), saveWorld(source)), "same save after continued use");
});

Deno.test("saveWorld writes string saves into a reused buffer", async () => {
  const source = await worldOf(components(newLog()));
  populate(source, rng(10));
  const expected = saveWorld(source);
  const target = new Uint8Array(expected.byteLength + 64);
  target.fill(0xff); // every pad byte must be written, not inherited
  for (let i = 0; i < 3; i++) {
    const written = saveWorld(source, target);
    assertStrictEquals(written.buffer, target.buffer, "written into the target");
    assert(bytesEqual(written, expected), "same bytes as a fresh save");
  }
});

// ---------------------------------------------------------------- bool, enum and entity fields

/** A unit with an enum, a bool and an entity ref, for the field-value range checks. */
// deno-lint-ignore explicit-function-return-type -- the inferred component types are the point of this factory
function refUnitOf() {
  return new Component({
    name: "unit",
    schema: { state: field.enum(["a", "b", "c"]), alive: field.bool(), target: field.entity() },
  });
}

// deno-lint-ignore no-explicit-any -- documents are edited freely to build invalid saves
type SaveDocument = any;

async function savedUnitDocument(): Promise<SaveDocument> {
  const unit = refUnitOf();
  const world = await worldOf([unit], 16);
  const target = world.entities.createOrThrow();
  world.entities.createOrThrow([[unit, { state: "b", alive: true, target }]]);
  return worldSaveToDocument(saveWorld(world));
}

async function assertRejected(document: SaveDocument, message: string, label: string): Promise<void> {
  const world = await worldOf([refUnitOf()], 16);
  const kept = world.entities.createOrThrow();
  assertThrows(() => loadWorld(world, worldSaveFromDocument(document)), WorldSaveError, message);
  assertEquals(world.entities.isActive(kept), true, `${label}: a rejected load leaves the world untouched`);
}

Deno.test("world saves reject field values outside their field type", async () => {
  const cases: [string, (values: Record<string, number[]>) => void][] = [
    ["enum index past the labels", (values) => values["state"]![0] = 3],
    ["bool other than 0 or 1", (values) => values["alive"]![0] = 7],
    ["negative entity ref other than -1", (values) => values["target"]![0] = -5],
  ];
  for (const [label, corrupt] of cases) {
    const document = await savedUnitDocument();
    corrupt(document.components.unit.values);
    await assertRejected(document, "outside its type", label);
  }
});

Deno.test("world saves reject a next generation that matches a live handle after masking", async () => {
  const document = await savedUnitDocument();
  const slot = document.entities.slots[0];
  document.entities.nextGenerations[slot] = document.entities.generations[0] + 0x8000;
  await assertRejected(document, "reissue its handle", "masked generation");
});

/** A 16-slot world, the capacity the bool / enum / entity save tests were written against. */
function smallWorldOf(list: DynamicComponent[]): Promise<World> {
  return worldOf(list, 16);
}

// deno-lint-ignore explicit-function-return-type -- the inferred component types are the point of this factory
function unitOf(labels: readonly string[] = ["idle", "run", "dead"], alive: unknown = field.bool()) {
  return new Component({
    name: "unit",
    schema: {
      hp: Uint16Array,
      alive: alive as ReturnType<typeof field.bool>,
      state: field.enum(labels),
      target: field.entity(),
    },
  });
}

Deno.test("saves x field types: bool, enum and entity fields round-trip into a fresh world", async () => {
  const unit = unitOf();
  const source = await smallWorldOf([unit]);
  const target = source.entities.createOrThrow();
  const doomed = source.entities.createOrThrow();
  const a = source.entities.createOrThrow([[unit, { hp: 3, alive: true, state: "run", target }]]);
  const b = source.entities.createOrThrow([[unit, { state: "dead", target: doomed }]]);
  source.entities.destroy(doomed);
  source.refresh();
  const bytes = saveWorld(source);

  const loaded = await smallWorldOf([unitOf()]);
  loadWorld(loaded, bytes);
  const loadedUnit = loaded.components.getInstance("unit")!.type as typeof unit;
  assertEquals(
    loaded.components.getEntityDataOrThrow(loadedUnit, a),
    { hp: 3, alive: true, state: "run", target },
    "Live values and live ref restored",
  );
  assertEquals(
    loaded.components.getEntityDataOrThrow(loadedUnit, b).target,
    null,
    "A ref to a dead entity still reads null",
  );
  assertEquals(loaded.components.getEntityDataOrThrow(loadedUnit, b).state, "dead", "Enum label restored");
});

Deno.test("saves x field types: the layout records field tags", async () => {
  const world = await smallWorldOf([unitOf()]);
  const fields = worldSaveLayout(world).components[0]!.fields!;
  assertEquals(
    fields.map((f) => f.type),
    ["u16", "bool", 'enum:["idle","run","dead"]', "entity"],
    "Field tags replace the physical column types",
  );
});

Deno.test("saves x field types: enum label order and bool-vs-u8 mismatches are rejected, world untouched", async () => {
  const sourceUnit = unitOf();
  const source = await smallWorldOf([sourceUnit]);
  source.entities.createOrThrow([[sourceUnit, { state: "run" }]]);
  const bytes = saveWorld(source);

  const reordered = await smallWorldOf([unitOf(["run", "idle", "dead"])]);
  const kept = reordered.entities.createOrThrow();
  assertThrows(() => loadWorld(reordered, bytes), WorldSaveError, "layout");
  assertEquals(reordered.entities.isActive(kept), true, "Rejected load leaves the world untouched");

  const numeric = await smallWorldOf([unitOf(undefined, Uint8Array)]);
  assertThrows(() => loadWorld(numeric, bytes), WorldSaveError, "layout");
});

Deno.test("saves x field types: the JSON view round-trips field tags", async () => {
  const unit = unitOf();
  const source = await smallWorldOf([unit]);
  source.entities.createOrThrow([[unit, { alive: true, state: "dead" }]]);
  const bytes = saveWorld(source);
  const document = worldSaveToDocument(bytes);
  const again = worldSaveFromDocument(JSON.parse(JSON.stringify(document)));
  assertEquals(Array.from(again), Array.from(bytes), "JSON view is lossless");
});

Deno.test("saves x field types: unsupported worlds throw on every entry point", async () => {
  const cases: [string, DynamicComponent][] = [
    ["meshed.mesh", new Component({ name: "meshed", schema: { hp: Uint8Array, mesh: field.object() } })],
  ];
  const plain = await smallWorldOf([unitOf()]);
  const bytes = saveWorld(plain);
  for (const [label, component] of cases) {
    const world = await smallWorldOf([unitOf(), component]);
    const kept = world.entities.createOrThrow();
    assertThrows(() => saveWorld(world), WorldSaveError, label);
    assertThrows(() => saveWorld(world, new Uint8Array(1 << 16)), WorldSaveError, label);
    assertThrows(() => worldSaveLayout(world), WorldSaveError, label);
    assertThrows(() => loadWorld(world, bytes), WorldSaveError, label);
    assertEquals(world.entities.isActive(kept), true, `${label}: rejected load leaves the world untouched`);
  }
});
