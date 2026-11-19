/// <reference lib="deno.ns" />

import {
  canonicalizeStoredValue,
  captureWorldRollbackPoint,
  commitWorldRollbackPoint,
  compileComponentSchema,
  ComponentDataError,
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
  for (let slot = 1; slot < 8; slot++) {
    assertStrictEquals(entityIndex(world.entities.createOrThrow()), slot, "next-fit issues untouched slots first");
  }
  const recycled = world.entities.createOrThrow();
  assertStrictEquals(entityIndex(recycled), 0, "slot 0 is reused once the allocator wraps");
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

Deno.test("createEcsWorld tags spawn, ownership, and collisions", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: {
      Position: { x: Float32Array, y: Float32Array },
    },
    tags: {
      Player: true,
      Hero: { maxEntities: 1 },
    },
  });
  await ecs.init();

  const player = ecs.spawn({ Position: { x: 1, y: 2 }, Player: true, Hero: true });
  assert(ecs.world.components.entityHas(ecs.components.Player, player), "Player tag attached");
  assert(ecs.world.components.entityHas(ecs.components.Hero, player), "Hero tag attached");
  assertStrictEquals(ecs.storage.Player.storage, null, "tag instances have no storage");

  assertThrows(
    () => ecs.spawn({ Position: { x: 0, y: 0 }, Hero: true }),
    RangeError,
    "can only be added to 1",
  );

  assertThrows(
    () =>
      createEcsWorld({
        capacity: 8,
        components: { Player: { x: Float32Array } },
        tags: { Player: true },
      }),
    Error,
    "collides with a component name",
  );
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

Deno.test("compileComponentSchema hash includes tags and maxEntities", () => {
  const withPlayer = compileComponentSchema(
    { Position: { x: Float32Array, y: Float32Array } },
    { Player: true, Hero: { maxEntities: 1 } },
  );
  const reordered = componentSchemaHash(
    { Position: { x: Float32Array, y: Float32Array } },
    { Hero: { maxEntities: 1 }, Player: true },
  );
  assertStrictEquals(withPlayer.schemaHash, reordered, "tag key order does not change hash");

  const uncappedHero = componentSchemaHash(
    { Position: { x: Float32Array, y: Float32Array } },
    { Player: true, Hero: true },
  );
  assert(
    withPlayer.schemaHash !== uncappedHero,
    "maxEntities changes the schema hash",
  );

  const noTags = componentSchemaHash({ Position: { x: Float32Array, y: Float32Array } });
  assert(withPlayer.schemaHash !== noTags, "adding tags changes the schema hash");
  assertStrictEquals(withPlayer.tagMap.Player, true, "compiled tagMap preserves true");
  assertEquals(
    withPlayer.tagMap.Hero,
    { maxEntities: 1 },
    "compiled tagMap preserves maxEntities",
  );
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
    ComponentDataError,
    "finite number",
  );
  const floatScratch = new Float32Array(1);
  assertThrows(
    () => canonicalizeStoredValue("Pos", "x", Number.POSITIVE_INFINITY, floatScratch),
    ComponentDataError,
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
    world.components.getEntityDataOrThrow(position, entity),
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
    world.components.getEntityDataOrThrow(position, entity),
    { x: 1, y: 2 },
    "rollback restores prior values",
  );

  const committed = captureWorldRollbackPoint(world);
  world.components.setEntityData(position, entity, { x: 3, y: 4 });
  commitWorldRollbackPoint(world, committed);
  assertEquals(
    world.components.getEntityDataOrThrow(position, entity),
    { x: 3, y: 4 },
    "commit keeps speculative writes",
  );
});
