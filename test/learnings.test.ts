/// <reference lib="deno.ns" />

import {
  canonicalizeStoredValue,
  captureWorldRollbackPoint,
  commitWorldRollbackPoint,
  compileComponentSchema,
  componentSchemaHash,
  createEcsWorld,
  entityGeneration,
  entityIndex,
  packEntity,
  Query,
  restoreWorldRollbackPoint,
} from "../mod.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";
import { createTestWorld, vec2Component } from "./fixtures.ts";

Deno.test("generational handles invalidate after destroy and reuse", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const first = world.entities.createOrThrow();
  assertStrictEquals(entityIndex(first), 0, "first entity uses slot 0");
  assertStrictEquals(entityGeneration(first), 0, "first entity starts at generation 0");

  world.entities.destroy(first);
  const recycled = world.entities.createOrThrow();
  assertStrictEquals(entityIndex(recycled), 0, "slot 0 is reused");
  assertStrictEquals(entityGeneration(recycled), 1, "generation bumps on reuse");
  assert(!world.entities.isActive(first), "stale handle must not be active");
  assert(world.entities.isActive(recycled), "new generation handle must be active");
  assertStrictEquals(packEntity(0, 1), recycled, "packed handle matches recycled entity");
});

Deno.test("world.frame refreshes after the tick callback", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const entity = world.entities.createOrThrow();
  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  let sawChanged = false;
  world.frame(() => {
    world.components.setEntityData(position, entity, { x: 3 });
    sawChanged = [...(world.components.getChanged(position) ?? [])].includes(entity);
  });
  assert(sawChanged, "changed set should be visible inside frame");
  assertEquals(
    [...(world.components.getChanged(position) ?? [])],
    [],
    "changed set clears after frame",
  );
});

Deno.test("queryRevision tracks relevant component writes", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], 8);
  const entity = world.entities.createOrThrow();
  world.components.addToEntity(position, entity, { x: 0, y: 0 });
  world.components.addToEntity(velocity, entity, { x: 0, y: 0 });

  const positionQuery = new Query({ all: [position] });
  const before = world.queryRevision(positionQuery);
  world.components.setEntityData(velocity, entity, { x: 1 });
  assertStrictEquals(
    world.queryRevision(positionQuery),
    before,
    "unrelated write leaves revision unchanged",
  );
  world.components.setEntityData(position, entity, { x: 2 });
  assert(world.queryRevision(positionQuery) > before, "related write bumps revision");
});

Deno.test("createEcsWorld spawn and storage access", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: {
      Position: { x: Float32Array, y: Float32Array },
    },
  });
  await ecs.init();
  const entity = ecs.spawn({ Position: { x: 4, y: 5 } });
  assertEquals(ecs.storage.Position.get(entity, "x"), 4, "spawn writes x");
  assertEquals(ecs.storage.Position.get(entity, "y"), 5, "spawn writes y");
});

Deno.test("compileComponentSchema hash is stable for equivalent maps", () => {
  const left = compileComponentSchema({
    Health: { hp: Uint16Array, maxHp: Uint16Array },
    Position: { x: Float32Array, y: Float32Array },
  });
  const right = componentSchemaHash({
    Position: { y: Float32Array, x: Float32Array },
    Health: { maxHp: Uint16Array, hp: Uint16Array },
  });
  assertStrictEquals(left.schemaHash, right, "schema hash ignores key order");
});

Deno.test("canonicalizeStoredValue coerces through typed storage", () => {
  const scratch = new Int8Array(1);
  assertStrictEquals(canonicalizeStoredValue("Face", "dir", -0, scratch), 0, "-0 becomes 0");
  assertStrictEquals(
    canonicalizeStoredValue("Face", "dir", 999, scratch),
    -25,
    "Int8 truncates overflow to stored bits",
  );
  assertThrows(
    () => canonicalizeStoredValue("Face", "dir", Number.NaN, scratch),
    TypeError,
    "finite number",
  );
  const floatScratch = new Float32Array(1);
  assertThrows(
    () => canonicalizeStoredValue("Pos", "x", Number.POSITIVE_INFINITY, floatScratch),
    TypeError,
    "finite number",
  );
});

Deno.test("checkpoint capture and apply round-trip component subsets", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const entity = world.entities.createOrThrow();
  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  const checkpoint = world.captureCheckpoint([entity], position);
  world.components.setEntityData(position, entity, { x: 9, y: 9 });
  world.applyCheckpoint(checkpoint);
  assertEquals(
    world.components.getEntityData(position, entity),
    { x: 1, y: 2 },
    "checkpoint restore recovers values",
  );
});

Deno.test("rollback restore reverts speculative mutations", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const entity = world.entities.createOrThrow();
  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  const point = captureWorldRollbackPoint(world);
  world.components.setEntityData(position, entity, { x: 8, y: 8 });
  restoreWorldRollbackPoint(world, point);
  assertEquals(
    world.components.getEntityData(position, entity),
    { x: 1, y: 2 },
    "rollback restores prior values",
  );

  const committed = captureWorldRollbackPoint(world);
  world.components.setEntityData(position, entity, { x: 3, y: 4 });
  commitWorldRollbackPoint(world, committed);
  assertEquals(
    world.components.getEntityData(position, entity),
    { x: 3, y: 4 },
    "commit keeps speculative writes",
  );
});
