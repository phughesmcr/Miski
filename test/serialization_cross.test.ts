/// <reference lib="deno.ns" />

import {
  Component,
  describeWorldSaveLayout,
  type DynamicComponent,
  field,
  loadWorld,
  measureWorldSave,
  Relation,
  saveWorld,
  saveWorldInto,
  World,
  WorldSaveError,
  worldSaveFromJSON,
  worldSaveToJSON,
} from "../mod.ts";
import { assertEquals, assertThrows } from "./helpers.ts";

async function worldOf(components: DynamicComponent[], capacity = 16): Promise<World> {
  const world = new World({ capacity, components });
  await world.init();
  return world;
}

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
  const source = await worldOf([unit]);
  const target = source.entities.createOrThrow();
  const doomed = source.entities.createOrThrow();
  const a = source.entities.createWithOrThrow([[unit, { hp: 3, alive: true, state: "run", target }]]);
  const b = source.entities.createWithOrThrow([[unit, { state: "dead", target: doomed }]]);
  source.entities.destroy(doomed);
  source.refresh();
  const bytes = saveWorld(source);

  const loaded = await worldOf([unitOf()]);
  loadWorld(loaded, bytes);
  const loadedUnit = loaded.components.getInstance("unit")!.type as typeof unit;
  assertEquals(
    loaded.components.getEntityData(loadedUnit, a),
    { hp: 3, alive: true, state: "run", target },
    "Live values and live ref restored",
  );
  assertEquals(loaded.components.getEntityData(loadedUnit, b).target, null, "A ref to a dead entity still reads null");
  assertEquals(loaded.components.getEntityData(loadedUnit, b).state, "dead", "Enum label restored");
});

Deno.test("saves x field types: the layout records field tags", async () => {
  const world = await worldOf([unitOf()]);
  const fields = describeWorldSaveLayout(world).components[0]!.fields!;
  assertEquals(
    fields.map((f) => f.type),
    ["u16", "bool", 'enum:["idle","run","dead"]', "entity"],
    "Field tags replace the physical column types",
  );
});

Deno.test("saves x field types: enum label order and bool-vs-u8 mismatches are rejected, world untouched", async () => {
  const sourceUnit = unitOf();
  const source = await worldOf([sourceUnit]);
  source.entities.createWithOrThrow([[sourceUnit, { state: "run" }]]);
  const bytes = saveWorld(source);

  const reordered = await worldOf([unitOf(["run", "idle", "dead"])]);
  const kept = reordered.entities.createOrThrow();
  assertThrows(() => loadWorld(reordered, bytes), WorldSaveError, "layout");
  assertEquals(reordered.entities.isActive(kept), true, "Rejected load leaves the world untouched");

  const numeric = await worldOf([unitOf(undefined, Uint8Array)]);
  assertThrows(() => loadWorld(numeric, bytes), WorldSaveError, "layout");
});

Deno.test("saves x field types: the JSON view round-trips field tags", async () => {
  const unit = unitOf();
  const source = await worldOf([unit]);
  source.entities.createWithOrThrow([[unit, { alive: true, state: "dead" }]]);
  const bytes = saveWorld(source);
  const document = worldSaveToJSON(bytes);
  const again = worldSaveFromJSON(JSON.parse(JSON.stringify(document)));
  assertEquals(Array.from(again), Array.from(bytes), "JSON view is lossless");
});

Deno.test("saves x field types and relations: unsupported worlds throw on every entry point", async () => {
  const cases: [string, DynamicComponent][] = [
    ["string", new Component({ name: "named", schema: { label: field.string() } })],
    ["object", new Component({ name: "meshed", schema: { hp: Uint8Array, mesh: field.object() } })],
    ["relation", new Relation({ name: "childOf", exclusive: true })],
  ];
  const plain = await worldOf([unitOf()]);
  const bytes = saveWorld(plain);
  for (const [label, component] of cases) {
    const world = await worldOf([unitOf(), component]);
    const kept = world.entities.createOrThrow();
    assertThrows(() => saveWorld(world), WorldSaveError, label);
    assertThrows(() => saveWorldInto(world, new Uint8Array(1 << 16)), WorldSaveError, label);
    assertThrows(() => measureWorldSave(world), WorldSaveError, label);
    assertThrows(() => describeWorldSaveLayout(world), WorldSaveError, label);
    assertThrows(() => loadWorld(world, bytes), WorldSaveError, label);
    assertEquals(world.entities.isActive(kept), true, `${label}: rejected load leaves the world untouched`);
  }
});
