/// <reference lib="deno.ns" />

import {
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  EntityNotFoundError,
  NotRegisteredError,
  Query,
  World,
  WorldStateError,
} from "../mod.ts";
import { ArchetypeManager } from "../src/archetype/archetype-manager.ts";
import { EntityManager } from "../src/entity/entity-manager.ts";
import type { QueryEntityList } from "../mod.ts";
import { assert, assertEquals, assertRejects, assertThrows, ids } from "./helpers.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };
type MixedWidth = { flag: number; value: number };

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

Deno.test("world storage accounts for aligned mixed-width component schemas", async () => {
  const mixed = new Component<MixedWidth>({
    name: "mixed",
    schema: { flag: Uint8Array, value: Float64Array },
  });
  const world = new World({ capacity: 9, components: [mixed] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");

  world.components.addToEntity(mixed, entity, { flag: 1, value: 2 });

  assertEquals(world.components.getEntityData(mixed, entity), { flag: 1, value: 2 }, "Expected mixed-width data");
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

Deno.test("failed refresh blocks lifecycle APIs like destroy errors", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  const query = new Query({ all: [position] });
  const originalRefresh = ArchetypeManager.prototype.refresh;

  await world.init();

  ArchetypeManager.prototype.refresh = function refresh(): ArchetypeManager {
    throw new Error("refresh failed");
  };

  try {
    assertThrows(() => world.refresh(), Error, "refresh failed");
    assertEquals(world.state, "error", "Expected failed refresh to move world into error state");
    assertThrows(() => world.entities.create(), WorldStateError, "World has encountered an error");
    assertThrows(() => world.components.addToEntity(position, 0), WorldStateError, "World has encountered an error");
    assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has encountered an error");
  } finally {
    ArchetypeManager.prototype.refresh = originalRefresh;
  }
});

Deno.test("queries reject components that are not registered in the world", async () => {
  const registered = new Component<null>({ name: "registered" });
  const unregistered = new Component<null>({ name: "unregistered" });
  const world = new World({ capacity: 8, components: [registered] });
  await world.init();

  assertThrows(
    () => ids(world.entities.query(new Query({ all: [unregistered] }))),
    NotRegisteredError,
    'Component "unregistered" is not registered in this world.',
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

Deno.test("query registered after init sees existing matching entities", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  world.refresh();

  const lateQuery = new Query({ all: [position] });

  assertEquals(
    ids(world.entities.query(lateQuery)),
    [entity],
    "Expected late query registration to see existing owner",
  );
  assertEquals(
    ids(world.archetypes.queryEntities(lateQuery)),
    [entity],
    "Expected late archetype query registration to see existing owner",
  );
});

Deno.test("registering a new query preserves pending entered and exited visibility", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  const positionQuery = new Query({ all: [position] });

  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  assertEquals(
    ids(world.entities.query(new Query({ all: [velocity] }))),
    [],
    "Expected new velocity query to register",
  );
  assertEquals(ids(world.archetypes.queryEntered(positionQuery)), [entity], "Expected entered state to remain visible");

  world.refresh();
  world.components.removeFromEntity(position, entity);
  assertEquals(
    ids(world.entities.query(new Query({ any: [position, velocity] }))),
    [],
    "Expected new any query to register",
  );
  assertEquals(ids(world.archetypes.queryExited(positionQuery)), [entity], "Expected exited state to remain visible");
});

Deno.test("clean refresh preserves query results and clears changed and transition state", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  const query = new Query({ all: [position] });
  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  assertEquals(ids(world.entities.query(query)), [entity], "Expected query to cache current owner");
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected ownership add to mark changed");
  assertEquals(ids(world.archetypes.queryEntered(query)), [entity], "Expected transition to be visible before refresh");

  world.refresh();

  assertEquals(ids(world.entities.query(query)), [entity], "Expected clean refresh to preserve query result behavior");
  assertEquals(ids(world.components.getChanged(position)), [], "Expected refresh to clear changed state");
  assertEquals(ids(world.archetypes.queryEntered(query)), [], "Expected refresh to clear entered state");
});

Deno.test("component transitions update cached query results immediately", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  world.refresh();

  const moving = new Query({ all: [position, velocity] });
  assertEquals(ids(world.entities.query(moving)), [], "Expected initial cached query to be empty");

  world.components.addToEntity(velocity, entity, { x: 3, y: 4 });
  assertEquals(ids(world.entities.query(moving)), [entity], "Expected add transition to update cached query");

  world.components.removeFromEntity(velocity, entity);
  assertEquals(ids(world.entities.query(moving)), [], "Expected remove transition to update cached query");
});

Deno.test("component query cache access does not freshen stale entity query results", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  const moving = new Query({ all: [position, velocity] });

  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  assertEquals(ids(world.entities.query(moving)), [], "Expected moving query to cache an empty result");

  world.components.addToEntity(velocity, entity, { x: 3, y: 4 });
  world.components.query(moving);

  assertEquals(
    ids(world.entities.query(moving)),
    [entity],
    "Expected component query cache access to leave entity cache invalidation intact",
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
    "Entity 3 is not active.",
  );

  assertEquals(ids(world.entities.query(new Query({ all: [position] }))), [], "Expected inactive entity to not match");
});

Deno.test("component removal rejects inactive entities and stays idempotent for active non-owners", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const owner = world.entities.create();
  const nonOwner = world.entities.create();
  assert(owner !== undefined && nonOwner !== undefined, "Expected entities to be created");
  world.components.addToEntity(position, owner, { x: 1, y: 2 });
  world.components.addToEntity(position, nonOwner, { x: 3, y: 4 });
  world.components.addToEntity(velocity, owner, { x: 5, y: 6 });

  assertThrows(
    () => world.components.removeFromEntity(velocity, 7),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );

  world.components.removeFromEntity(velocity, nonOwner);
  assert(world.components.entityHas(position, nonOwner), "Expected non-owner removal to leave other ownership intact");
  assert(!world.components.entityHas(velocity, nonOwner), "Expected non-owner to remain without velocity");

  const list: QueryEntityList = { count: 2, indices: new Uint32Array([owner, nonOwner]) };
  assertEquals(world.components.removeFromEntities(velocity, list), 1, "Expected only actual owners to be removed");
  assert(!world.components.entityHas(velocity, owner), "Expected owner to lose velocity");
  assert(world.components.entityHas(position, owner), "Expected batch removal to leave other ownership intact");
});

Deno.test("batch component removal rejects inactive entities without partial mutation", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const first = world.entities.create();
  assert(first !== undefined, "Expected entity to be created");
  world.components.addToEntity(position, first, { x: 1, y: 2 });

  const list: QueryEntityList = { count: 2, indices: new Uint32Array([first, 7]) };
  assertThrows(
    () => world.components.removeFromEntities(position, list),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );
  assert(world.components.entityHas(position, first), "Expected failed batch removal to leave ownership intact");
  assertEquals(
    ids(world.entities.query(new Query({ all: [position] }))),
    [first],
    "Expected query state to stay intact",
  );
});

Deno.test("batch component add capacity failures leave all state unchanged", async () => {
  const player = new Component<null>({ name: "player", maxEntities: 1 });
  const world = new World({ capacity: 8, components: [player] });
  await world.init();

  const first = world.entities.create();
  const second = world.entities.create();
  assert(first !== undefined && second !== undefined, "Expected entities to be created");

  const list: QueryEntityList = { count: 2, indices: new Uint32Array([first, second]) };
  assertThrows(
    () => world.components.addToEntities(player, list),
    RangeError,
    'Component "player" can only be added to 1 entities',
  );

  assert(!world.components.entityHas(player, first), "Expected first entity to remain without player");
  assert(!world.components.entityHas(player, second), "Expected second entity to remain without player");
  assertEquals(ids(world.components.getOwners(player)), [], "Expected owners to remain unchanged");
  assertEquals(ids(world.entities.query(new Query({ all: [player] }))), [], "Expected query state to remain unchanged");
});

Deno.test("batch component transitions reject duplicate entity targets before mutation", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  const duplicateList: QueryEntityList = { count: 2, indices: new Uint32Array([entity, entity]) };
  assertThrows(
    () => world.components.addToEntities(velocity, duplicateList, { x: 3, y: 4 }),
    RangeError,
    "Duplicate entity",
  );

  assert(!world.components.entityHas(velocity, entity), "Expected duplicate batch add to leave ownership unchanged");
  assertEquals(ids(world.entities.query(new Query({ all: [position, velocity] }))), [], "Expected query state intact");
});

Deno.test("public component data APIs reject inactive, unregistered, tag, and non-owner access", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const tag = new Component<null>({ name: "tag" });
  const unregistered = new Component<Vec2>({ name: "unregistered", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position, velocity, tag] });
  await world.init();

  const owner = world.entities.create();
  const nonOwner = world.entities.create();
  assert(owner !== undefined && nonOwner !== undefined, "Expected entities to be created");
  world.components.addToEntity(position, owner, { x: 1, y: 2 });
  world.components.addToEntity(tag, owner);

  assertThrows(
    () => world.components.getEntityData(position, 7),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );
  assertThrows(
    () => world.components.setEntityData(position, 7, { x: 3, y: 4 }),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );
  assertThrows(
    () => world.components.getEntityData(unregistered, owner),
    NotRegisteredError,
    "not registered",
  );
  assertThrows(
    () => world.components.setEntityData(unregistered, owner, { x: 3, y: 4 }),
    NotRegisteredError,
    "not registered",
  );
  assertThrows(
    () => world.components.getEntityData(tag, owner),
    ComponentDataError,
    "has no data storage",
  );
  assertThrows(
    () => world.components.setEntityData(tag, owner, {}),
    ComponentDataError,
    "has no data storage",
  );
  assertThrows(
    () => world.components.getEntityData(velocity, nonOwner),
    ComponentOwnershipError,
    "does not own component",
  );
  assertThrows(
    () => world.components.setEntityData(velocity, nonOwner, { x: 3, y: 4 }),
    ComponentOwnershipError,
    "does not own component",
  );
});

Deno.test("failed guarded data access does not mark changed state or mutate storage", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const owner = world.entities.create();
  const nonOwner = world.entities.create();
  assert(owner !== undefined && nonOwner !== undefined, "Expected entities to be created");
  world.components.addToEntity(position, owner, { x: 1, y: 2 });
  const instance = world.components.getInstance(position);
  assert(instance !== undefined && instance.storage !== null, "Expected position storage");
  const storage = instance.storage.partitions;
  storage.x[nonOwner] = 9;
  storage.y[nonOwner] = 10;
  world.refresh();

  assertThrows(
    () => world.components.setEntityData(position, nonOwner, { x: 99, y: 100 }),
    ComponentOwnershipError,
    "does not own component",
  );
  assertThrows(
    () => world.components.getEntityData(position, nonOwner),
    ComponentOwnershipError,
    "does not own component",
  );
  assertEquals(world.components.getEntityData(position, owner), { x: 1, y: 2 }, "Expected owner data to be intact");
  assertEquals(
    { x: storage.x[nonOwner], y: storage.y[nonOwner] },
    { x: 9, y: 10 },
    "Expected raw storage to be intact",
  );
  assertEquals(ids(world.components.getChanged(position)), [], "Expected failed guarded access to stay untracked");
});

Deno.test("components.require returns registered instances and exposes partitions", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const tag = new Component({ name: "tag" });
  const world = new World({ capacity: 8, components: [position, tag] });
  await world.init();

  const instance = world.components.require(position);
  assert(instance === world.components.getInstance(position), "Expected require to match getInstance");
  assert(instance.partitions !== null, "Expected schema component partitions");
  assert(instance.partitions === instance.storage?.partitions, "Expected partitions getter to forward storage");

  const tagInstance = world.components.require(tag);
  assertEquals(tagInstance.partitions, null, "Expected tag component partitions to be null");

  assertThrows(
    () => world.components.require("missing"),
    NotRegisteredError,
    'Component "missing" is not registered in this world.',
  );
});

Deno.test("direct typed-array storage remains an unguarded data access escape hatch", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  const instance = world.components.getInstance(position);
  assert(instance !== undefined && instance.storage !== null, "Expected position storage");

  instance.storage.partitions.x[entity] = 12;
  instance.storage.partitions.y[entity] = 13;
  assertEquals(
    { x: instance.storage.partitions.x[entity], y: instance.storage.partitions.y[entity] },
    { x: 12, y: 13 },
    "Expected raw storage writes to work without ownership checks",
  );
  assertThrows(
    () => world.components.getEntityData(position, entity),
    ComponentOwnershipError,
    "does not own component",
  );
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
