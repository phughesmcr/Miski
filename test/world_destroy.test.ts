import { Component, World } from "../mod.ts";

function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (Object.is(actual, expected)) return;
  throw new Error(message ?? `Assertion failed: Expected ${String(expected)}, got ${String(actual)}`);
}

type Tag = null;

Deno.test("world.destroy() cleans up entities and components", async () => {
  const tag = new Component<Tag>({ name: "tag", schema: null });
  type NumSchema = { v: Float32ArrayConstructor };
  const data = new Component<NumSchema>({ name: "data", schema: { v: Float32Array } });
  const world = new World({ capacity: 8, components: [tag, data] });
  await world.init();

  const a = world.entities.create()!;
  const b = world.entities.create()!;
  world.components.addToEntity(tag, a);
  world.components.addToEntity(tag, b);
  world.refresh();

  assertEquals(world.entities.getActiveCount(), 2, "precondition: two active entities");

  await world.destroy();

  assertEquals(world.state, "destroyed", "world should be in destroyed state");
  assertEquals(world.entities.getActiveCount(), 0, "all entities should be destroyed");
  assert(!world.entities.isActive(a), "entity a should be inactive");
  assert(!world.entities.isActive(b), "entity b should be inactive");
});


