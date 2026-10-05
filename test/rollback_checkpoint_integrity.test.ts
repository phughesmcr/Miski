import { captureWorldRollbackPoint, commitWorldRollbackPoint, Component, restoreWorldRollbackPoint } from "../mod.ts";
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
  const first = captureWorldRollbackPoint(world);
  assertThrows(() => captureWorldRollbackPoint(world), Error, "rollback scope is already active");

  restoreWorldRollbackPoint(world, first);
  const second = captureWorldRollbackPoint(world);
  assertThrows(() => captureWorldRollbackPoint(world), Error, "rollback scope is already active");

  commitWorldRollbackPoint(world, second);
  const third = captureWorldRollbackPoint(world);
  commitWorldRollbackPoint(world, third);
});

Deno.test("rollback points are single-use and bound to the capturing world", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const other = await createTestWorld([vec2Component()]);

  const restored = captureWorldRollbackPoint(world);
  restoreWorldRollbackPoint(world, restored);
  assertThrows(() => restoreWorldRollbackPoint(world, restored), TypeError, "Invalid or consumed");
  assertThrows(() => commitWorldRollbackPoint(world, restored), TypeError, "Invalid or consumed");

  const committed = captureWorldRollbackPoint(world);
  commitWorldRollbackPoint(world, committed);
  assertThrows(() => restoreWorldRollbackPoint(world, committed), TypeError, "Invalid or consumed");
  assertThrows(() => commitWorldRollbackPoint(world, committed), TypeError, "Invalid or consumed");

  const owned = captureWorldRollbackPoint(world);
  assertThrows(() => restoreWorldRollbackPoint(other, owned), TypeError, "Invalid or consumed");
  assertThrows(() => commitWorldRollbackPoint(other, owned), TypeError, "Invalid or consumed");
  // A rejected foreign use must neither consume the point nor disturb the other world's scope.
  const otherPoint = captureWorldRollbackPoint(other);
  assertThrows(() => restoreWorldRollbackPoint(world, otherPoint), TypeError, "Invalid or consumed");
  restoreWorldRollbackPoint(world, owned);
  restoreWorldRollbackPoint(other, otherPoint);
});

Deno.test("component checkpoints cannot be applied to a different world", async () => {
  const position = vec2Component();
  const source = await createTestWorld([position]);
  const target = await createTestWorld([position]);
  const sourceEntity = source.entities.createWithOrThrow([[position, { x: 1, y: 2 }]]);
  const targetEntity = target.entities.createWithOrThrow([[position, { x: 7, y: 8 }]]);
  assertEquals(sourceEntity, targetEntity, "Both worlds issue the same first handle");

  const checkpoint = source.captureCheckpoint([sourceEntity], position);
  assertThrows(() => target.applyCheckpoint(checkpoint), Error, "different world");
  assertEquals(
    target.components.getEntityData(position, targetEntity),
    { x: 7, y: 8 },
    "A rejected foreign checkpoint must not change the target world",
  );

  source.components.setEntityData(position, sourceEntity, { x: 9, y: 9 });
  source.applyCheckpoint(checkpoint);
  assertEquals(source.components.getEntityData(position, sourceEntity), { x: 1, y: 2 }, "Owner world still applies it");
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
  assertEquals(world.components.getEntityData(first, entity), { v: 1 }, "Restore first component");
  assertEquals(world.components.getEntityData(middle, entity), { v: 34 }, "Restore component past bit 32");
  assertEquals(world.components.getEntityData(last, entity), { v: 40 }, "Re-attach the removed high component");

  const point = captureWorldRollbackPoint(world);
  world.components.setEntityData(last, entity, { v: 500 });
  world.components.removeFromEntity(middle, entity);
  const speculative = createEntity(world);
  world.components.addToEntity(last, speculative, { v: 600 });
  restoreWorldRollbackPoint(world, point);

  for (const [index, component] of components.entries()) {
    assertEquals(
      world.components.getEntityData(component, entity),
      { v: index + 1 },
      `Rollback restores data component ${index}`,
    );
  }
  assert(!world.entities.isActive(speculative), "Rollback discards speculative entities");
  assert(!world.components.entityHas(last, speculative), "Rollback discards speculative ownership");
});
