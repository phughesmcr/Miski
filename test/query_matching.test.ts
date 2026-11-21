/// <reference lib="deno.ns" />
import { Component, NotRegisteredError, Query, SpecError, System } from "../mod.ts";
import { queryInternals } from "../src/query/query.ts";
import { createEntity, createTestWorld, gameComponents, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids, listIds } from "./helpers.ts";

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
    assertStrictEquals(
      bindings[key],
      world.components.getInstanceOrThrow(position),
      "alias resolves the intended component",
    );
    assertStrictEquals(Object.getPrototypeOf(bindings), null, "bindings have no inherited aliases");
    assert(Object.isFrozen(bindings), "bindings are immutable");
    assertEquals(listIds(world.entities.queryList(query)), [entity], "special aliases preserve matching");
    assert(Object.isFrozen(queryInternals(query).allEntries[0]!), "normalized entries are immutable");
    assertThrows(
      () => {
        (queryInternals(query).allEntries[0]! as { key: string }).key = "changed";
      },
      TypeError,
      "read only",
    );
  }
  const query = new Query({ all: [position], any: [velocity], none: [excluded], include: [included] });
  assertEquals(queryInternals(query).dependencyComponents.map((component) => component.name), [
    position.name,
    velocity.name,
    excluded.name,
    included.name,
  ], "revision dependencies include every clause");
  assert(Object.isFrozen(queryInternals(query).dependencyComponents), "revision dependencies are immutable");
  await world.destroy();
});

Deno.test("Query.compose keeps an include entry's component in its filtering role from another input", () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const composed = Query.compose([new Query({ all: { a } }), new Query({ all: { b }, include: { a } })]);
  assertEquals(composed.all.map((component) => component.name), ["a", "b"], "all is unioned");
  assertEquals(composed.include.length, 0, "the redundant include entry is dropped");

  const anyComposed = Query.compose([
    new Query({ any: { a, b } }),
    new Query({ none: { c: tagComponent("c") }, include: { a } }),
  ]);
  assertEquals(anyComposed.include.length, 0, "an include entry covered by `any` is dropped");

  // A different key for the same component is still ambiguous for callbacks.
  assertThrows(
    () => Query.compose([new Query({ all: { a } }), new Query({ all: { b }, include: { other: a } })]),
    SpecError,
    "Query specification object is invalid",
  );
});

Deno.test("include exposes optional component instances without filtering render query membership", async () => {
  const { Door, Drawable, Facing, GridPos, Health } = gameComponents();
  const world = await createTestWorld([GridPos, Facing, Drawable, Health, Door], 16);
  const withFacing = createEntity(world);
  const noFacing = createEntity(world);
  const withHealth = createEntity(world);
  const hidden = createEntity(world);

  world.components.addBundle(withFacing, [
    [GridPos, { x: 1, y: 2 }],
    [Facing, { dir: 2 }],
    [Drawable],
  ]);
  world.components.addBundle(noFacing, [
    [GridPos, { x: 3, y: 4 }],
    [Drawable],
  ]);
  world.components.addBundle(withHealth, [
    [GridPos, { x: 5, y: 6 }],
    [Drawable],
    [Health, { hp: 9 }],
  ]);
  world.components.addBundle(hidden, [
    [GridPos, { x: 7, y: 8 }],
    [Facing, { dir: 1 }],
  ]);

  const renderQuery = new Query({
    all: { pos: GridPos, drawable: Drawable },
    include: { facing: Facing, health: Health, door: Door },
  });
  const components = world.components.query(renderQuery);

  assertEquals(
    ids(world.entities.query(renderQuery)),
    [withFacing, noFacing, withHealth],
    "Expected include components not to filter render query membership",
  );
  assert(components["facing"]?.has(withFacing) === true, "Expected included Facing to report owners");
  assert(components["facing"]?.has(noFacing) === false, "Expected included Facing to report non-owners");
  assert(components["health"]?.has(withHealth) === true, "Expected included Health to report owners");
  assert(components["door"]?.has(withFacing) === false, "Expected included Door tag to report non-owners");

  const rendered: string[] = [];
  const renderSystem = new System({
    name: "renderEvidence",
    query: renderQuery,
    callback: (renderComponents, entities): void => {
      const posX = renderComponents.pos.storage.partitions.x;
      const posY = renderComponents.pos.storage.partitions.y;
      const facing = renderComponents.facing.storage.partitions.dir;
      for (let i = 0; i < entities.count; i++) {
        const entity = entities.entities[i]!;
        const slot = entities.slots[i]!;
        const dir = renderComponents.facing.has(entity) ? facing[slot] : 0;
        const hp = renderComponents.health.has(entity) ? renderComponents.health.storage.partitions.hp[slot] : 0;
        rendered.push(`${entity}:${posX[slot]},${posY[slot]}:${dir}:${hp}`);
      }
    },
  });

  world.systems.register(renderSystem)();

  assertEquals(
    rendered,
    [`${withFacing}:1,2:2:0`, `${noFacing}:3,4:0:0`, `${withHealth}:5,6:0:9`],
    "Expected render fixture to use direct partitions and included ownership checks",
  );
});

Deno.test("include query validation rejects overlap and include-only specs", () => {
  const { Drawable, Facing, GridPos } = gameComponents();

  assertThrows(
    () => new Query({ include: [Facing] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ all: [GridPos], include: [GridPos] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ any: [Drawable], include: [Drawable] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ none: [Facing], include: [Facing] }),
    SpecError,
    "Query specification object is invalid",
  );
});

Deno.test("queries reject components that are not registered in the world", async () => {
  const registered = tagComponent("registered");
  const unregistered = tagComponent("unregistered");
  const world = await createTestWorld([registered], 8);

  assertThrows(
    () => ids(world.entities.query(new Query({ all: [unregistered] }))),
    NotRegisteredError,
    'Component "unregistered" is not registered in this world.',
  );
});

Deno.test("query any and none clauses match through component bitfields", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const disabled = tagComponent("disabled");
  const world = await createTestWorld([position, velocity, disabled], 8);

  const positionEntity = createEntity(world);
  const velocityEntity = createEntity(world);
  const disabledEntity = createEntity(world);

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

Deno.test("none-only queries include active entities in the root archetype", async () => {
  const disabled = tagComponent("disabled");
  const marker = tagComponent("marker");
  const world = await createTestWorld([disabled, marker], 8);

  const rootEntity = createEntity(world);
  const disabledEntity = createEntity(world);
  world.components.addToEntity(disabled, disabledEntity);

  const active = new Query({ none: [disabled] });

  assertEquals(
    ids(world.entities.query(active)),
    [rootEntity],
    "Expected componentless active entities to match none-only queries",
  );
});

Deno.test("destroyed entities are removed from archetype membership", async () => {
  const disabled = tagComponent("disabled");
  const marker = tagComponent("marker");
  const world = await createTestWorld([disabled, marker], 8);

  const entity = createEntity(world);
  assertEquals(world.entities.isEmpty(entity), true, "Expected a new componentless entity to be empty");
  world.components.addToEntity(marker, entity);
  assertEquals(world.entities.isEmpty(entity), false, "Expected an entity with a component not to be empty");
  world.components.removeFromEntity(marker, entity);
  world.entities.destroy(entity);

  assertEquals(world.entities.isEmpty(entity), false, "Expected destroyed entity to leave root membership");
  assertEquals(
    ids(world.entities.query(new Query({ none: [disabled] }))),
    [],
    "Expected destroyed componentless entities not to match none-only queries",
  );
});

Deno.test("query registered after init sees existing matching entities", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);

  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  world.refresh();

  const lateQuery = new Query({ all: [position] });

  assertEquals(
    ids(world.entities.query(lateQuery)),
    [entity],
    "Expected late query registration to see existing owner",
  );
});
