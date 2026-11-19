/// <reference lib="deno.ns" />

import {
  Component,
  describeWorldSaveLayout,
  loadWorld,
  saveWorld,
  World,
  WorldRollbackScope,
  worldSaveFromJSON,
  worldSaveToJSON,
} from "../mod.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";

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
  const data = world.components.getEntityData(half, e) as { v: number; w: number };
  assertEquals(data.v, Math.f16round(0.1), "stored as f16");
  assertThrows(() => world.components.setEntityData(half, e, { v: 70000, w: 0 }), TypeError, "storage range");
  world.components.setEntityData(half, e, { v: -0, w: 0 });
  assert(Object.is((world.components.getEntityData(half, e) as { v: number }).v, 0), "-0 canonicalized");
  world.components.setEntityData(half, e, { v: 65504, w: 1 });

  const bytes = saveWorld(world);
  const target = await make();
  loadWorld(target, bytes);
  assertEquals(
    (target.components.getEntityData(half, e) as { v: number }).v,
    65504,
    "f16 roundtrip through binary save",
  );
  const doc = worldSaveToJSON(bytes);
  const back = worldSaveFromJSON(JSON.parse(JSON.stringify(doc)));
  assertEquals(back.length, bytes.length, "JSON roundtrip size");
  console.log(JSON.stringify(describeWorldSaveLayout(world)));

  const point = new WorldRollbackScope(world);
  world.components.setEntityData(half, e, { v: 2, w: 2 });
  point.restore();
  assertEquals((world.components.getEntityData(half, e) as { v: number }).v, 65504, "rollback");
});
