/// <reference lib="deno.ns" />

import {
  CapacityError,
  ComponentDataError,
  createEcsWorld,
  NotRegisteredError,
  Query,
  SpecError,
  System,
} from "../mod.ts";
import type { Entity } from "../mod.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";

Deno.test("getEntityData returns data for an owning entity", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  world.components.addToEntity(position, entity, { x: 3, y: 4 });

  assertEquals(world.components.getEntityData(position, entity), { x: 3, y: 4 }, "Expected owner data");
});

Deno.test("getEntityData returns undefined instead of throwing for non-owners", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  assertStrictEquals(world.components.getEntityData(position, entity), undefined, "Expected undefined for non-owner");
});

Deno.test("getEntityData returns undefined for inactive entities", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  world.entities.destroy(entity);

  assertStrictEquals(
    world.components.getEntityData(position, entity),
    undefined,
    "Expected undefined for inactive entity",
  );
});

Deno.test("getEntityData returns undefined for tag components", async () => {
  const renderable = tagComponent("renderable");
  const world = await createTestWorld([renderable]);
  const entity = createEntity(world);

  world.components.addToEntity(renderable, entity);

  assertStrictEquals(
    world.components.getEntityData(renderable, entity),
    undefined,
    "Expected undefined for tag component",
  );
});

Deno.test("getEntityData still throws for unregistered components", async () => {
  const position = vec2Component();
  const unregistered = vec2Component("unregistered");
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  assertThrows(
    () => world.components.getEntityData(unregistered, entity),
    NotRegisteredError,
    "not registered",
  );
});

Deno.test("addToEntity upserts data for entities that already own the component", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  world.components.addToEntity(position, entity, { y: 5 });

  assertEquals(world.components.getEntityDataOrThrow(position, entity), { x: 1, y: 5 }, "Expected merged upsert data");
});

Deno.test("addToEntities reports zero ownership changes for a pure data upsert", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const first = createEntity(world);
  const second = createEntity(world);

  world.components.addToEntity(position, first, { x: 1, y: 1 });
  world.components.addToEntity(position, second, { x: 2, y: 2 });

  const changed = world.components.addToEntities(position, {
    count: 2,
    entities: [first, second],
    slots: [first, second],
  }, { x: 9 });

  assertStrictEquals(changed, 0, "Expected no ownership changes");
  assertEquals(world.components.getEntityDataOrThrow(position, first), { x: 9, y: 1 }, "Expected first entity upsert");
  assertEquals(
    world.components.getEntityDataOrThrow(position, second),
    { x: 9, y: 2 },
    "Expected second entity upsert",
  );
});

Deno.test("setEntityData applies partial updates and keeps omitted keys", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  world.components.addToEntity(position, entity, { x: 3, y: 4 });
  world.components.setEntityData(position, entity, { x: 9 });

  assertEquals(world.components.getEntityDataOrThrow(position, entity), { x: 9, y: 4 }, "Expected partial update");
});

Deno.test("setEntityData rejects keys explicitly set to undefined", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);

  world.components.addToEntity(position, entity, { x: 3, y: 4 });
  assertThrows(
    () => world.components.setEntityData(position, entity, { x: undefined, y: 7 }),
    ComponentDataError,
    'data field "x" cannot be undefined',
  );

  assertEquals(
    world.components.getEntityDataOrThrow(position, entity),
    { x: 3, y: 4 },
    "Expected rejected write to be inert",
  );
});

Deno.test("createOrThrow creates active entities", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);

  const entity = world.entities.createOrThrow();

  assert(world.entities.isActive(entity), "Expected created entity to be active");
});

Deno.test("createOrThrow throws CapacityError when the world is full", async () => {
  const position = vec2Component();
  const capacity = 8;
  const world = await createTestWorld([position], capacity);

  for (let i = 0; i < capacity; i++) {
    world.entities.createOrThrow();
  }

  assertThrows(
    () => world.entities.createOrThrow(),
    CapacityError,
    "capacity (8 entities)",
  );
});

Deno.test("queryList results are iterable with for-of", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const query = new Query({ all: [position] });

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.addToEntity(position, first, { x: 1, y: 1 });
  world.components.addToEntity(position, second, { x: 2, y: 2 });

  const list = world.entities.queryList(query);
  const iterated = [...list].sort((a, b) => a - b);

  assertEquals(iterated, [first, second].sort((a, b) => a - b), "Expected for-of to yield the dense prefix");
});

Deno.test("queryList iteration supports nesting", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const query = new Query({ all: [position] });

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.addToEntity(position, first, { x: 1, y: 1 });
  world.components.addToEntity(position, second, { x: 2, y: 2 });

  const list = world.entities.queryList(query);
  const pairs: [Entity, Entity][] = [];
  for (const a of list) {
    for (const b of list) {
      pairs.push([a, b]);
    }
  }

  assertStrictEquals(pairs.length, list.count * list.count, "Expected nested iteration to visit all pairs");
});

Deno.test("system callbacks receive iterable entity lists", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);

  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1, y: 1 });

  const collect = new System({
    name: "collect",
    query: new Query({ all: { position } }),
    callback: (_components, entities): Entity[] => [...entities],
  });
  const collectInstance = world.systems.register(collect);

  assertEquals(collectInstance(), [entity], "Expected system entities to be iterable");
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
  const entity = ecs.spawnOrThrow({ Position: { x: 4, y: 5 } });
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
      Hero: { maxOwners: 1 },
    },
  });
  await ecs.init();

  const player = ecs.spawnOrThrow({ Position: { x: 1, y: 2 }, Player: true, Hero: true });
  assert(ecs.world.components.entityHas(ecs.components.Player, player), "Player tag attached");
  assert(ecs.world.components.entityHas(ecs.components.Hero, player), "Hero tag attached");
  assertStrictEquals(ecs.storage.Player.storage, null, "tag instances have no storage");

  assertThrows(
    () => ecs.spawn({ Position: { x: 0, y: 0 }, Hero: true }),
    CapacityError,
    "can only be added to 1",
  );

  assertThrows(
    () =>
      createEcsWorld({
        capacity: 8,
        components: { Player: { x: Float32Array } },
        tags: { Player: true },
      }),
    SpecError,
    "collides with a component name",
  );
});
