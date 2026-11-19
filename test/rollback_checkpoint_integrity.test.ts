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
    target.components.getEntityDataOrThrow(position, targetEntity),
    { x: 7, y: 8 },
    "A rejected foreign checkpoint must not change the target world",
  );

  source.components.setEntityData(position, sourceEntity, { x: 9, y: 9 });
  source.applyCheckpoint(checkpoint);
  assertEquals(
    source.components.getEntityDataOrThrow(position, sourceEntity),
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
    world.components.addToEntity(component, entity, { v: index + 1 });
  }
  world.refresh();

  const checkpoint = world.captureCheckpoint([entity], first, middle, last);
  world.components.setEntityData(first, entity, { v: 100 });
  world.components.setEntityData(middle, entity, { v: 200 });
  world.components.removeFromEntity(last, entity);
  world.applyCheckpoint(checkpoint);
  assertEquals(world.components.getEntityDataOrThrow(first, entity), { v: 1 }, "Restore first component");
  assertEquals(world.components.getEntityDataOrThrow(middle, entity), { v: 34 }, "Restore component past bit 32");
  assertEquals(world.components.getEntityDataOrThrow(last, entity), { v: 40 }, "Re-attach the removed high component");

  const point = new WorldRollbackScope(world);
  world.components.setEntityData(last, entity, { v: 500 });
  world.components.removeFromEntity(middle, entity);
  const speculative = createEntity(world);
  world.components.addToEntity(last, speculative, { v: 600 });
  point.restore();

  for (const [index, component] of components.entries()) {
    assertEquals(
      world.components.getEntityDataOrThrow(component, entity),
      { v: index + 1 },
      `Rollback restores data component ${index}`,
    );
  }
  assert(!world.entities.isActive(speculative), "Rollback discards speculative entities");
  assert(!world.components.entityHas(last, speculative), "Rollback discards speculative ownership");
});
