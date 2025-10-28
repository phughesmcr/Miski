// deno-lint-ignore-file no-explicit-any
import { Component, Query, World } from "../mod.ts";

function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (Object.is(actual, expected)) return;
  throw new Error(message ?? `Assertion failed: Expected ${String(expected)}, got ${String(actual)}`);
}

function iterToArray<T>(iter: IterableIterator<T> | undefined): T[] {
  if (!iter) return [];
  return [...iter];
}

type Vec2Schema = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

function createWorld(): { world: World; position: Component<Vec2Schema> } {
  const position = new Component<Vec2Schema>({
    name: "position",
    schema: { x: Float32Array, y: Float32Array },
  });
  const world = new World({ capacity: 8, components: [position] });
  return { world, position };
}

Deno.test("world.refresh() clears both changed flags and deltas", async () => {
  const { world, position } = createWorld();
  await world.init();

  const q = new Query({ all: [position] });
  const e = world.entities.create()!;
  world.components.addToEntity(position, e, { x: 1, y: 2 });

  // Internal refresh(true) happened during add; deltas and changed should be present.
  assert(iterToArray(world.archetypes.queryEntered(q)).includes(e), "entity should be in entered before clearing");
  assert(iterToArray(world.components.getChanged(position)).includes(e), "entity should be in changed before clearing");

  // Default refresh clears both
  world.refresh();
  assertEquals(iterToArray(world.archetypes.queryEntered(q)).length, 0, "entered should be cleared by default refresh");
  assertEquals(iterToArray(world.components.getChanged(position)).length, 0, "changed should be cleared by default refresh");
});

Deno.test("world.refresh(true) retains both changed flags and deltas", async () => {
  const { world, position } = createWorld();
  await world.init();

  const q = new Query({ all: [position] });
  const e = world.entities.create()!;
  world.components.addToEntity(position, e, { x: 1, y: 2 });

  world.refresh(true);
  assert(iterToArray(world.archetypes.queryEntered(q)).includes(e), "entered should be retained when retainDeltas=true");
  assert(iterToArray(world.components.getChanged(position)).includes(e), "changed should be retained when retainChanged=true");

  // Cleanup
  world.refresh();
});

Deno.test("world.refresh(true, false) clears deltas, retains changed", async () => {
  const { world, position } = createWorld();
  await world.init();

  const q = new Query({ all: [position] });
  const e = world.entities.create()!;
  world.components.addToEntity(position, e, { x: 1, y: 2 });

  world.refresh(true, false);
  assertEquals(iterToArray(world.archetypes.queryEntered(q)).length, 0, "entered should be cleared when retainDeltas=false");
  assert(iterToArray(world.components.getChanged(position)).includes(e), "changed should be retained when retainChanged=true");

  // Cleanup
  world.refresh();
});

Deno.test("world.refresh(false, true) retains deltas, clears changed", async () => {
  const { world, position } = createWorld();
  await world.init();

  const q = new Query({ all: [position] });
  const e = world.entities.create()!;
  world.components.addToEntity(position, e, { x: 1, y: 2 });

  world.refresh(false, true);
  assert(iterToArray(world.archetypes.queryEntered(q)).includes(e), "entered should be retained when retainDeltas=true");
  assertEquals(iterToArray(world.components.getChanged(position)).length, 0, "changed should be cleared when retainChanged=false");

  // Cleanup
  world.refresh();
});


