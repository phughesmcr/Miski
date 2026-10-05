/// <reference lib="deno.ns" />
import { Component, Query } from "../mod.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, listIds } from "./helpers.ts";
import { createTestWorld, vec2Component } from "./fixtures.ts";

Deno.test("query aliases use own keys and normalized metadata stays immutable", async () => {
  const position = vec2Component();
  const velocity = new Component({ name: "velocity", schema: { x: Float32Array } });
  const excluded = new Component({ name: "excluded" });
  const included = new Component({ name: "included", schema: { x: Float32Array } });
  const world = await createTestWorld([position, velocity, excluded, included], 8);
  const entity = world.entities.createOrThrow();
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  for (const key of ["constructor", "toString", "__proto__"]) {
    const query = Query.compose([new Query({ all: { [key]: position } })]);
    const bindings = world.components.query(query);
    assert(Object.hasOwn(bindings, key), `alias ${key} remains an own binding`);
    assertStrictEquals(bindings[key], world.components.require(position), "alias resolves the intended component");
    assertStrictEquals(Object.getPrototypeOf(bindings), null, "bindings have no inherited aliases");
    assert(Object.isFrozen(bindings), "bindings are immutable");
    assertEquals(listIds(world.entities.queryList(query)), [entity], "special aliases preserve matching");
    assert(Object.isFrozen(query.allEntries[0]!), "normalized entries are immutable");
    assertThrows(
      () => {
        (query.allEntries[0]! as { key: string }).key = "changed";
      },
      TypeError,
      "read only",
    );
  }
  const query = new Query({ all: [position], any: [velocity], none: [excluded], include: [included] });
  assertEquals(query.dependencyComponents.map((component) => component.name), [
    position.name,
    velocity.name,
    excluded.name,
    included.name,
  ], "revision dependencies include every clause");
  assert(Object.isFrozen(query.dependencyComponents), "revision dependencies are immutable");
  await world.destroy();
});

Deno.test("query entity results retain their buffer across invalidation", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const query = new Query({ all: [position] });
  const bindings = world.components.query(query);
  const first = world.entities.queryList(query);
  assertStrictEquals(world.entities.queryList(query), first, "unchanged queries reuse the result");
  const entity = world.entities.createOrThrow();
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  const filled = world.entities.queryList(query);
  assertStrictEquals(filled, first, "invalidated queries refill the retained result");
  assertEquals(listIds(filled), [entity], "refill reflects membership");
  assertStrictEquals(world.components.query(query), bindings, "immutable bindings are retained independently");
  const snapshot = world.entities.querySnapshot(query);
  world.entities.destroy(entity);
  assertStrictEquals(world.entities.queryList(query), first, "removal also retains the result");
  assertEquals(listIds(first), [], "removal clears the valid prefix");
  assertEquals(snapshot, [entity], "snapshots retain stable identity after mutation");
  await world.destroy();
});
