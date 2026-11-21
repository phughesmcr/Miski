import { ArgumentError, Component, WorldRollbackScope, WorldStateError } from "../mod.ts";
import { createEntity, createTestWorld, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";

function manyDataComponents(count: number): Component<{ v: number }>[] {
  return Array.from(
    { length: count },
    (_, index) => new Component<{ v: number }>({ name: `data${index}`, schema: { v: Float32Array } }),
  );
}

Deno.test("a world permits only one active rollback scope until it is restored or committed", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const first = new WorldRollbackScope(world);
  assertThrows(() => new WorldRollbackScope(world), WorldStateError, "rollback scope is already active");

  first.restore();
  const second = new WorldRollbackScope(world);
  assertThrows(() => new WorldRollbackScope(world), WorldStateError, "rollback scope is already active");

  second.commit();
  const third = new WorldRollbackScope(world);
  third.commit();
});

Deno.test("rollback scopes close once and are bound to the capturing world", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const other = await createTestWorld([vec2Component()]);

  const restored = new WorldRollbackScope(world);
  restored.restore();
  assertThrows(() => restored.restore(), WorldStateError, "already closed");
  assertThrows(() => restored.commit(), WorldStateError, "already closed");

  const committed = new WorldRollbackScope(world);
  committed.commit();
  assertThrows(() => committed.restore(), WorldStateError, "already closed");
  assertThrows(() => committed.commit(), WorldStateError, "already closed");

  // Each world holds its own scope: one world's open scope neither blocks nor disturbs the other's.
  const owned = new WorldRollbackScope(world);
  const otherScope = new WorldRollbackScope(other);
  otherScope.restore();
  owned.restore();
});

Deno.test("component checkpoints cannot be applied to a different world", async () => {
  const position = vec2Component();
  const source = await createTestWorld([position]);
  const target = await createTestWorld([position]);
  const sourceEntity = source.entities.createOrThrow([[position, { x: 1, y: 2 }]]);
  const targetEntity = target.entities.createOrThrow([[position, { x: 7, y: 8 }]]);
  assertEquals(sourceEntity, targetEntity, "Both worlds issue the same first handle");

  const checkpoint = source.captureCheckpoint([sourceEntity], position);
  assertThrows(() => target.applyCheckpoint(checkpoint), ArgumentError, "different world");
  assertEquals(
    target.components.getDataOrThrow(position, targetEntity),
    { x: 7, y: 8 },
    "A rejected foreign checkpoint must not change the target world",
  );

  source.components.setData(position, sourceEntity, { x: 9, y: 9 });
  source.applyCheckpoint(checkpoint);
  assertEquals(
    source.components.getDataOrThrow(position, sourceEntity),
    { x: 1, y: 2 },
    "Owner world still applies it",
  );
});

Deno.test("checkpoint and rollback round-trip worlds with more than 32 data components", async () => {
  const components = manyDataComponents(40);
  const world = await createTestWorld(components);
  const [first, middle, last] = [components[0]!, components[33]!, components[39]!];
  const entity = createEntity(world);
  for (const [index, component] of components.entries()) {
    world.components.add(component, entity, { v: index + 1 });
  }
  world.refresh();

  const checkpoint = world.captureCheckpoint([entity], first, middle, last);
  world.components.setData(first, entity, { v: 100 });
  world.components.setData(middle, entity, { v: 200 });
  world.components.remove(last, entity);
  world.applyCheckpoint(checkpoint);
  assertEquals(world.components.getDataOrThrow(first, entity), { v: 1 }, "Restore first component");
  assertEquals(world.components.getDataOrThrow(middle, entity), { v: 34 }, "Restore component past bit 32");
  assertEquals(world.components.getDataOrThrow(last, entity), { v: 40 }, "Re-attach the removed high component");

  const point = new WorldRollbackScope(world);
  world.components.setData(last, entity, { v: 500 });
  world.components.remove(middle, entity);
  const speculative = createEntity(world);
  world.components.add(last, speculative, { v: 600 });
  point.restore();

  for (const [index, component] of components.entries()) {
    assertEquals(
      world.components.getDataOrThrow(component, entity),
      { v: index + 1 },
      `Rollback restores data component ${index}`,
    );
  }
  assert(!world.entities.isActive(speculative), "Rollback discards speculative entities");
  assert(!world.components.has(last, speculative), "Rollback discards speculative ownership");
});

Deno.test("checkpoint capture and apply round-trip component subsets", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const entity = world.entities.createOrThrow();
  world.components.add(position, entity, { x: 1, y: 2 });

  const checkpoint = world.captureCheckpoint([entity], position);
  world.components.setData(position, entity, { x: 9, y: 9 });
  world.applyCheckpoint(checkpoint);
  assertEquals(
    world.components.getDataOrThrow(position, entity),
    { x: 1, y: 2 },
    "checkpoint restore recovers values",
  );
});

Deno.test("rollback restore reverts speculative mutations", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const entity = world.entities.createOrThrow();
  world.components.add(position, entity, { x: 1, y: 2 });

  const point = new WorldRollbackScope(world);
  world.components.setData(position, entity, { x: 8, y: 8 });
  point.restore();
  assertEquals(
    world.components.getDataOrThrow(position, entity),
    { x: 1, y: 2 },
    "rollback restores prior values",
  );

  const committed = new WorldRollbackScope(world);
  world.components.setData(position, entity, { x: 3, y: 4 });
  committed.commit();
  assertEquals(
    world.components.getDataOrThrow(position, entity),
    { x: 3, y: 4 },
    "commit keeps speculative writes",
  );
});
