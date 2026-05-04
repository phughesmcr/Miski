/// <reference lib="deno.ns" />

import { Component, EntityNotFoundError, Query, World, WorldStateError } from "../mod.ts";
import { EntityManager } from "../src/entity/EntityManager.ts";
import { NotRegisteredError } from "../src/errors.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, ErrorClass: new (...args: any[]) => Error, messageIncludes: string): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof ErrorClass, `Expected ${ErrorClass.name}, got ${error}`);
    assert(
      error instanceof Error && error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}", got "${error instanceof Error ? error.message : error}"`,
    );
    return;
  }
  throw new Error(`Expected ${ErrorClass.name} to be thrown`);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass: new (...args: any[]) => Error,
  messageIncludes: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof ErrorClass, `Expected ${ErrorClass.name}, got ${error}`);
    assert(
      error instanceof Error && error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}", got "${error instanceof Error ? error.message : error}"`,
    );
    return;
  }
  throw new Error(`Expected ${ErrorClass.name} to be thrown`);
}

function ids(iterable: Iterable<number> | undefined): number[] {
  return iterable ? [...iterable] : [];
}

Deno.test("tag components with maxEntities: 1 can be registered in a world", async () => {
  const player = new Component<null>({ name: "player", maxEntities: 1 });
  const world = new World({ capacity: 8, components: [player] });

  await world.init();

  assert(world.components.isRegistered(player), "Expected tag component to be registered");
});

Deno.test("component maxEntities limits the number of owners", async () => {
  const player = new Component<null>({ name: "player", maxEntities: 1 });
  const world = new World({ capacity: 8, components: [player] });
  await world.init();

  const first = world.entities.create();
  const second = world.entities.create();
  assert(first !== undefined && second !== undefined, "Expected entities to be created");

  world.components.addToEntity(player, first);

  assertThrows(
    () => world.components.addToEntity(player, second),
    RangeError,
    'Component "player" can only be added to 1 entities',
  );
  assertEquals(ids(world.components.getOwners(player)), [first], "Expected only the first entity to own player");
});

Deno.test("component maxEntities slots can be reused after removal", async () => {
  const position = new Component<Vec2>({
    name: "position",
    schema: { x: Float32Array, y: Float32Array },
    maxEntities: 1,
  });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const first = world.entities.create();
  const second = world.entities.create();
  assert(first !== undefined && second !== undefined, "Expected entities to be created");

  world.components.addToEntity(position, first, { x: 1, y: 2 });
  world.components.removeFromEntity(position, first);
  world.components.addToEntity(position, second, { x: 3, y: 4 });

  assertEquals(world.components.getEntityData(position, second), { x: 3, y: 4 }, "Expected sparse slot reuse");
  assertEquals(ids(world.components.getOwners(position)), [second], "Expected only the second entity to own position");
});

Deno.test("query entered and exited entities remain visible until explicit refresh", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  const query = new Query({ all: [position] });

  world.components.addToEntity(position, entity);
  assertEquals(ids(world.entities.query(query)), [entity], "Expected entity to match position query");
  assertEquals(ids(world.archetypes.queryEntered(query)), [entity], "Expected entity to appear in entered query");

  world.refresh();
  assertEquals(ids(world.archetypes.queryEntered(query)), [], "Expected entered query to clear after refresh");

  world.components.removeFromEntity(position, entity);
  assertEquals(ids(world.entities.query(query)), [], "Expected entity to stop matching position query");
  assertEquals(ids(world.archetypes.queryExited(query)), [entity], "Expected entity to appear in exited query");

  world.refresh();
  assertEquals(ids(world.archetypes.queryExited(query)), [], "Expected exited query to clear after refresh");
});

Deno.test("queries reject components that are not registered in the world", async () => {
  const registered = new Component<null>({ name: "registered" });
  const unregistered = new Component<null>({ name: "unregistered" });
  const world = new World({ capacity: 8, components: [registered] });
  await world.init();

  assertThrows(
    () => ids(world.entities.query(new Query({ all: [unregistered] }))),
    NotRegisteredError,
    'Component "unregistered" not registered',
  );
});

Deno.test("query any and none clauses match through component bitfields", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const disabled = new Component<null>({ name: "disabled" });
  const world = new World({ capacity: 8, components: [position, velocity, disabled] });
  await world.init();

  const positionEntity = world.entities.create();
  const velocityEntity = world.entities.create();
  const disabledEntity = world.entities.create();
  assert(positionEntity !== undefined, "Expected position entity to be created");
  assert(velocityEntity !== undefined, "Expected velocity entity to be created");
  assert(disabledEntity !== undefined, "Expected disabled entity to be created");

  world.components.addToEntity(position, positionEntity);
  world.components.addToEntity(velocity, velocityEntity);
  world.components.addToEntity(position, disabledEntity);
  world.components.addToEntity(disabled, disabledEntity);

  const movable = new Query({ any: [position, velocity], none: [disabled] });

  assertEquals(
    ids(world.entities.query(movable)),
    [positionEntity, velocityEntity],
    "Expected any/none query to include matching entities and exclude disabled entities",
  );
});

Deno.test("setEntityData marks the component changed when storage is updated", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  world.refresh();

  world.components.setEntityData(position, entity, { x: 3, y: 4 });

  assertEquals(world.components.getEntityData(position, entity), { x: 3, y: 4 }, "Expected storage to update");
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected setEntityData to mark changed");
});

Deno.test("queryExited ignores archetype exits while the entity still matches the query", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const renderable = new Component<null>({ name: "renderable" });
  const world = new World({ capacity: 8, components: [position, velocity, renderable] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  const query = new Query({ any: [position, velocity] });

  world.components.addToEntity(position, entity);
  world.components.addToEntity(velocity, entity);
  world.components.addToEntity(renderable, entity);
  world.refresh();

  world.components.removeFromEntity(renderable, entity);
  world.components.removeFromEntity(velocity, entity);

  assertEquals(ids(world.entities.query(query)), [entity], "Expected entity to still match through position");
  assertEquals(ids(world.archetypes.queryExited(query)), [], "Expected no query exit while still matching");
});

Deno.test("world.onReady rejects after the world has been destroyed", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();
  await world.destroy();

  await assertRejects(() => world.onReady(), WorldStateError, 'state is "destroyed"');
});

Deno.test("components cannot be added to inactive entities", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  assert(!world.entities.isActive(3), "Expected entity 3 to be inactive");
  assertThrows(
    () => world.components.addToEntity(position, 3, { x: 1, y: 2 }),
    EntityNotFoundError,
    "Entity 3 is not active",
  );

  assertEquals(ids(world.entities.query(new Query({ all: [position] }))), [], "Expected inactive entity to not match");
});

Deno.test("entity manager serializes and restores BitPool state", () => {
  const manager = new EntityManager(8);
  const first = manager.create();
  const second = manager.create();
  assert(first !== undefined && second !== undefined, "Expected entities to be created");

  const restored = EntityManager.fromJSON(manager.stringify());

  assertEquals(ids(restored.getActive()), [first, second], "Expected active entities to survive serialization");
  assertEquals(restored.getAvailableCount(), 6, "Expected available count to survive serialization");
});
