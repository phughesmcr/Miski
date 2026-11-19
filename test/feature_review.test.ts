/// <reference lib="deno.ns" />

// Regressions from the post-merge review of field types, relations, the scheduler, prefabs and world saves.

import {
  ArgumentError,
  CommandBuffer,
  Component,
  type DynamicComponent,
  type Entity,
  field,
  loadWorld,
  Prefab,
  Relation,
  saveWorld,
  World,
  WorldSaveError,
  worldSaveFromDocument,
  worldSaveToDocument,
} from "../mod.ts";
import { createTestWorld } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

function listOf(list: { readonly count: number; readonly entities: { readonly [index: number]: number } }): number[] {
  return Array.from({ length: list.count }, (_, i) => list.entities[i]!);
}

// ---------------------------------------------------------------- world saves

function unitOf() {
  return new Component({
    name: "unit",
    schema: { state: field.enum(["a", "b", "c"]), alive: field.bool(), target: field.entity() },
  });
}

// deno-lint-ignore no-explicit-any
type SaveDocument = any;

async function savedUnitDocument(): Promise<SaveDocument> {
  const unit = unitOf();
  const world = await createTestWorld([unit], 16);
  const target = world.entities.createOrThrow();
  world.entities.createOrThrow([[unit, { state: "b", alive: true, target }]]);
  return worldSaveToDocument(saveWorld(world));
}

async function assertRejected(document: SaveDocument, message: string, label: string): Promise<void> {
  const world = await createTestWorld([unitOf()], 16);
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

// ---------------------------------------------------------------- prefabs

Deno.test("a create() hook that breaks its contract by instantiating does not corrupt its caller's borrowed list", async () => {
  const inner = new Component({ name: "inner", schema: { x: Uint8Array } });
  let world!: World;
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
  world = await createTestWorld([inner, host], 16);
  const outer = new Prefab({ components: [[host]] });
  const list = world.entities.instantiateManyOrThrow(outer, 3);
  const entities = listOf(list);
  assertStrictEquals(entities.length, 3, "Outer list holds only its own entities");
  for (const entity of entities) {
    assert(world.components.entityHas(host, entity as Entity), `Outer entity ${entity} has the prefab component`);
  }
});

// ---------------------------------------------------------------- relations

Deno.test("applying a checkpoint with unchanged pairs keeps source order and marks nothing changed", async () => {
  const likes = new Relation({ name: "likes" });
  const world = await createTestWorld([likes], 16);
  const target = world.entities.createOrThrow();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  world.relations.add(likes, a, target);
  world.relations.add(likes, b, target);
  const checkpoint = world.captureCheckpoint([b, a], likes);
  world.refresh();
  world.applyCheckpoint(checkpoint);
  assertEquals(listOf(world.relations.getSources(likes, target)), [a, b], "Reverse order kept");
  assertEquals([...world.relations.getChanged(likes)], [], "No change recorded");
});

Deno.test("relation pair data treats undefined values as absent", async () => {
  const weighted = new Relation({ name: "weighted", schema: { weight: Float32Array } });
  const world = await createTestWorld([weighted], 16);
  const source = world.entities.createOrThrow();
  const target = world.entities.createOrThrow();
  world.relations.add(weighted, source, target, { weight: undefined });
  assertEquals(world.relations.getData(weighted, source, target), { weight: 0 }, "Absent on add: zero");
  world.relations.setData(weighted, source, target, { weight: 2 });
  world.relations.setData(weighted, source, target, { weight: undefined });
  assertEquals(world.relations.getData(weighted, source, target), { weight: 2 }, "Absent on set: unchanged");
});

// ---------------------------------------------------------------- command buffers

Deno.test("command buffers reject relation components when queuing, not at flush", async () => {
  const childOf = new Relation({ name: "childOf", exclusive: true });
  const tag = new Component({ name: "tag" });
  const components: DynamicComponent[] = [childOf, tag];
  const world = await createTestWorld(components, 16);
  const commands = new CommandBuffer(world);
  const entity = world.entities.createOrThrow();
  assertThrows(() => commands.add(childOf, entity), ArgumentError, "relation");
  assertThrows(() => commands.remove(childOf, entity), ArgumentError, "relation");
  assertThrows(() => commands.spawn([[tag], [childOf]]), ArgumentError, "relation");
  assertStrictEquals(commands.pendingCount, 0, "Nothing queued");
});
