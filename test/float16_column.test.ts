/// <reference lib="deno.ns" />

import {
  Component,
  ComponentDataError,
  loadWorld,
  saveWorld,
  World,
  WorldRollbackScope,
  worldSaveFromDocument,
  worldSaveLayout,
  worldSaveToDocument,
} from "../mod.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";
import type { NoFloat16Report } from "./no_float16_worker.ts";

const half = new Component({ name: "half", schema: { v: Float16Array, w: Float32Array } });

async function make(): Promise<World> {
  const world = new World({ capacity: 16, components: [half] });
  await world.init();
  return world;
}

Deno.test("Float16Array column: write, canonicalize, save, JSON, rollback", async () => {
  const world = await make();
  const e = world.entities.create()!;
  world.components.addToEntity(half, e, { v: 0.1, w: 0.1 });
  const data = world.components.getEntityDataOrThrow(half, e) as { v: number; w: number };
  assertEquals(data.v, Math.f16round(0.1), "stored as f16");
  assertThrows(() => world.components.setEntityData(half, e, { v: 70000, w: 0 }), ComponentDataError, "storage range");
  world.components.setEntityData(half, e, { v: -0, w: 0 });
  assert(Object.is((world.components.getEntityDataOrThrow(half, e) as { v: number }).v, 0), "-0 canonicalized");
  world.components.setEntityData(half, e, { v: 65504, w: 1 });

  const bytes = saveWorld(world);
  const target = await make();
  loadWorld(target, bytes);
  assertEquals(
    (target.components.getEntityDataOrThrow(half, e) as { v: number }).v,
    65504,
    "f16 roundtrip through binary save",
  );
  const doc = worldSaveToDocument(bytes);
  const back = worldSaveFromDocument(JSON.parse(JSON.stringify(doc)));
  assertEquals(back.length, bytes.length, "JSON roundtrip size");
  assertEquals(
    worldSaveLayout(world).components[0]!.fields!.map((f) => f.type),
    ["f16", "f32"],
    "the layout records the f16 column type",
  );

  const point = new WorldRollbackScope(world);
  world.components.setEntityData(half, e, { v: 2, w: 2 });
  point.restore();
  assertEquals((world.components.getEntityDataOrThrow(half, e) as { v: number }).v, 65504, "rollback");
});

Deno.test("without a Float16Array global, Miski still imports and works, and rejects f16 saves", async () => {
  const world = await make();
  const e = world.entities.createOrThrow();
  world.components.addToEntity(half, e, { v: 1, w: 1 });
  const f16Save = saveWorld(world);

  const worker = new Worker(new URL("./no_float16_worker.ts", import.meta.url), { type: "module" });
  const report = await new Promise<NoFloat16Report>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<NoFloat16Report>) => resolve(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      reject(new Error(event.message));
    };
    worker.postMessage({ f16Save });
  });

  assertEquals(report.importError, undefined, "imports without Float16Array");
  assertEquals(report.roundTrip, 1.5, "an f32 world saves and loads");
  assertEquals(report.stillAbsent, true, "Miski does not define Float16Array");
  // The unsupported-type message, not a layout mismatch with the worker's f32 world.
  const unsupported = 'WorldSaveError: World save layout field half.v has unsupported type "f16".';
  assertEquals(report.f16LoadError, unsupported, "an f16 save is rejected, not misread");
  assertEquals(report.f16DocumentError, unsupported, "an f16 save does not convert to a document");
});
