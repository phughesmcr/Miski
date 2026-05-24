/// <reference lib="deno.ns" />

import { Component, defineSystem, EntityNotFoundError, Query, System, World, WorldStateError } from "../mod.ts";
import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows, ids, listIds } from "./helpers.ts";
import type { BorrowedEntityIterator, BorrowedEntityList, ComponentInstance, Entity, QueryEntityList } from "../mod.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };
type Health = { current: Uint16ArrayConstructor; max: Uint16ArrayConstructor };

function vec2Component(name = "position"): Component<Vec2> {
  return new Component<Vec2>({ name, schema: { x: Float32Array, y: Float32Array } });
}

function createEntity(world: World): Entity {
  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  return entity;
}

Deno.test("world enforces entity capacity and reuses destroyed entity slots without stale components", async () => {
  const position = vec2Component();
  const renderable = new Component<null>({ name: "renderable" });
  const world = new World({ capacity: 8, components: [position, renderable] });
  await world.init();

  const entities = Array.from({ length: 8 }, () => createEntity(world));
  const first = entities[0]!;
  const second = entities[1]!;
  const third = entities[2]!;
  assertStrictEquals(world.entities.create(), undefined, "Expected create() to return undefined when capacity is full");

  world.components.addToEntity(position, second, { x: 10, y: 20 });
  world.components.addToEntity(renderable, second);
  assertEquals(ids(world.entities.query(new Query({ all: [position, renderable] }))), [second], "Expected setup match");

  world.entities.destroy(second);

  assertEquals(
    ids(world.entities.getActive()),
    [first, third, ...entities.slice(3)],
    "Expected destroyed entity to leave active iteration",
  );
  assertEquals(ids(world.entities.query(new Query({ all: [position] }))), [], "Expected destroy to remove components");
  assertEquals(ids(world.components.getOwners(position)), [], "Expected destroy to clear component ownership");
  assert(world.archetypes.isEntityInRoot(second), "Expected destroyed entity to be reset to the root archetype");

  const replacement = createEntity(world);
  assertStrictEquals(
    replacement,
    second,
    "Expected entity IDs to be recycled for stable, allocation-free gameplay loops",
  );
  assert(
    !world.components.entityHas(position, replacement),
    "Expected recycled entity to start without stale components",
  );
});

Deno.test("component data APIs expose initial data, mutation, and per-frame dense changed tracking", async () => {
  const position = vec2Component();
  const renderable = new Component<null>({ name: "renderable" });
  const world = new World({ capacity: 8, components: [position, renderable] });
  await world.init();

  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1.5, y: -2 });
  world.components.addToEntity(renderable, entity);

  assertEquals(
    world.components.getEntityData(position, entity),
    { x: 1.5, y: -2 },
    "Expected initial data to be stored",
  );
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected addToEntity to mark component changed");
  assertEquals(
    ids(world.components.getChanged(renderable)),
    [],
    "Expected tag components to stay out of changed state",
  );

  world.refresh();
  assertEquals(ids(world.components.getChanged(position)), [], "Expected refresh to clear changed tracking");

  world.components.setEntityData(position, entity, { x: 4, y: 9 });

  assertEquals(
    world.components.getEntityData(position, entity),
    { x: 4, y: 9 },
    "Expected setEntityData to update storage",
  );
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected setEntityData to mark changed entities");
});

Deno.test("component proxy tracks only real writes and direct storage access remains an opt-out fast path", async () => {
  const position = vec2Component();
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 0, y: 0 });
  const instance = world.components.getInstance(position);
  assert(instance !== undefined, "Expected component instance to exist");
  const storage = instance.storage;
  const proxy = instance.proxy;
  assert(storage !== null && proxy !== null, "Expected component instance with proxy and storage");

  world.refresh();
  storage.partitions.x[entity] = 99;
  assertEquals(
    ids(world.components.getChanged(position)),
    [],
    "Expected direct storage writes to avoid changed tracking",
  );

  proxy.entity = entity;
  proxy.x = 99;
  assertEquals(ids(world.components.getChanged(position)), [], "Expected idempotent proxy writes to stay untracked");

  proxy.y = 100;
  assertEquals(
    world.components.getEntityData(position, entity),
    { x: 99, y: 100 },
    "Expected proxy write to update data",
  );
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected proxy writes to mark changed entities");
});

Deno.test("changed iteration reuses dense storage and tracks each entity once per frame", async () => {
  const position = vec2Component();
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.addToEntity(position, first, { x: 0, y: 0 });
  world.components.addToEntity(position, second, { x: 1, y: 1 });
  world.refresh();

  const instance = world.components.getInstance(position);
  assert(instance !== undefined && instance.proxy !== null, "Expected data component instance");

  world.components.setEntityData(position, first, { x: 2, y: 2 });
  world.components.setEntityData(position, first, { x: 3, y: 3 });
  instance.proxy.entity = first;
  instance.proxy.x = 4;
  instance.proxy.y = 5;
  world.components.setEntityData(position, second, { x: 6, y: 6 });

  const firstRead = world.components.getChanged(position);
  const secondRead = world.components.getChanged(position);

  assert(firstRead !== undefined && secondRead !== undefined, "Expected changed iterator for registered component");
  assertStrictEquals(secondRead, firstRead, "Expected getChanged to reuse the component's borrowed iterator");
  assertEquals(ids(firstRead), [first, second], "Expected one dense changed entry per entity");

  world.components.removeFromEntity(position, first);
  assertEquals(ids(world.components.getChanged(position)), [second], "Expected removal to erase changed membership");

  world.refresh();
  assertEquals(ids(world.components.getChanged(position)), [], "Expected refresh to reset dense changed count");
});

Deno.test("proxy rejects out-of-range entity targets before mutating component storage", async () => {
  const position = vec2Component();
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const instance = world.components.getInstance(position);
  assert(instance !== undefined, "Expected component instance to exist");
  const proxy = instance.proxy;
  assert(proxy !== null, "Expected component proxy to exist");

  assertThrows(
    () => {
      proxy.entity = 8;
    },
    EntityNotFoundError,
    "Entity 8 not found",
  );
});

Deno.test("systems receive matching component instances, borrowed entity lists, and frame arguments", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const first = createEntity(world);
  world.components.addToEntity(position, first, { x: 10, y: 20 });
  world.components.addToEntity(velocity, first, { x: 1, y: -2 });

  const movement = new System({
    name: "movement",
    query: new Query({ all: [position, velocity] }),
    callback: (components, entities, dt: number) => {
      const positionInstance = components["position"] as ComponentInstance<Vec2> | undefined;
      const velocityInstance = components["velocity"] as ComponentInstance<Vec2> | undefined;
      assert(positionInstance !== undefined, "Expected position component to be available");
      assert(velocityInstance !== undefined, "Expected velocity component to be available");
      const positionStore = positionInstance.storage;
      const velocityStore = velocityInstance.storage;
      assert(positionStore !== null && velocityStore !== null, "Expected movement components to have storage");
      for (let i = 0; i < entities.count; i++) {
        const entity = entities.indices[i]!;
        const nextX = (positionStore.partitions.x[entity] ?? Number.NaN) +
          (velocityStore.partitions.x[entity] ?? Number.NaN) * dt;
        const nextY = (positionStore.partitions.y[entity] ?? Number.NaN) +
          (velocityStore.partitions.y[entity] ?? Number.NaN) * dt;
        positionStore.partitions.x[entity] = nextX;
        positionStore.partitions.y[entity] = nextY;
      }
    },
  });

  const updateMovement = world.systems.create(movement);
  updateMovement(2);
  assertEquals(world.components.getEntityData(position, first), { x: 12, y: 16 }, "Expected first movement update");

  const second = createEntity(world);
  world.components.addToEntity(position, second, { x: 0, y: 0 });
  world.components.addToEntity(velocity, second, { x: 3, y: 4 });

  updateMovement(1);

  assertEquals(
    ids(world.entities.query(new Query({ all: [position, velocity] }))),
    [first, second],
    "Expected system query to see entities added after system creation",
  );
  assertEquals(
    world.components.getEntityData(position, first),
    { x: 13, y: 14 },
    "Expected first entity to update again",
  );
  assertEquals(world.components.getEntityData(position, second), { x: 3, y: 4 }, "Expected second entity to update");
  assertStrictEquals(world.systems.get(movement), updateMovement, "Expected systems to be retrievable by prototype");
  assertStrictEquals(world.systems.get("movement"), updateMovement, "Expected systems to be retrievable by name");
});

Deno.test("defineSystem creates the same query behavior as manual System construction", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const renderable = new Component<null>({ name: "renderable" });
  const sleeping = new Component<null>({ name: "sleeping" });
  const world = new World({ capacity: 8, components: [position, velocity, renderable, sleeping] });
  await world.init();

  const matching = createEntity(world);
  const missingAny = createEntity(world);
  const blocked = createEntity(world);
  world.components.addToEntity(position, matching);
  world.components.addToEntity(velocity, matching);
  world.components.addToEntity(renderable, matching);
  world.components.addToEntity(position, missingAny);
  world.components.addToEntity(velocity, missingAny);
  world.components.addToEntity(position, blocked);
  world.components.addToEntity(velocity, blocked);
  world.components.addToEntity(renderable, blocked);
  world.components.addToEntity(sleeping, blocked);

  const manualQuery = new Query({ all: [position, velocity], any: [renderable], none: [sleeping] });
  const typedSystem = defineSystem({
    name: "typedMovement",
    all: { position, velocity },
    any: { renderable },
    none: { sleeping },
    callback: () => {},
  });

  assertEquals(
    ids(world.entities.query(typedSystem.query)),
    ids(world.entities.query(manualQuery)),
    "Expected query match",
  );
  assertEquals(ids(world.entities.query(typedSystem.query)), [matching], "Expected all/any/none behavior to match");
});

Deno.test("defineSystem instances receive keyed component records and borrowed entity lists", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const first = createEntity(world);
  world.components.addToEntity(position, first, { x: 1, y: 2 });
  world.components.addToEntity(velocity, first, { x: 3, y: 4 });

  const seen: Entity[][] = [];
  const movement = defineSystem({
    name: "typedMovement",
    all: { position, velocity },
    callback: (components, entities, dt: number) => {
      const current = listIds(entities);
      seen.push(current);
      const positionStorage = components.position.storage;
      const velocityStorage = components.velocity.storage;
      assert(positionStorage !== null && velocityStorage !== null, "Expected data components to have storage");
      for (let i = 0; i < entities.count; i++) {
        const entity = entities.indices[i]!;
        positionStorage.partitions.x[entity] = (positionStorage.partitions.x[entity] ?? 0) +
          (velocityStorage.partitions.x[entity] ?? 0) * dt;
      }
    },
  });

  const updateMovement = world.systems.create(movement);
  updateMovement(2);

  const second = createEntity(world);
  world.components.addToEntity(position, second, { x: 10, y: 0 });
  world.components.addToEntity(velocity, second, { x: 1, y: 0 });
  updateMovement(1);

  assertEquals(seen, [[first], [first, second]], "Expected each invocation to receive a fresh entity iterator");
  assertEquals(world.components.getEntityData(position, first), { x: 10, y: 2 }, "Expected first entity updates");
  assertEquals(world.components.getEntityData(position, second), { x: 11, y: 0 }, "Expected second entity updates");
});

Deno.test("system lifecycle hooks run during world initialization and destruction", async () => {
  const position = vec2Component();
  const calls: string[] = [];
  const world = new World({ capacity: 8, components: [position] });
  const lifecycle = new System({
    name: "lifecycle",
    query: new Query({ all: [position] }),
    init: (hookWorld) => {
      assertStrictEquals(hookWorld, world, "Expected init hook to receive the world");
      calls.push("init");
    },
    destroy: (hookWorld) => {
      assertStrictEquals(hookWorld, world, "Expected destroy hook to receive the world");
      calls.push("destroy");
    },
    callback: () => {
      calls.push("callback");
    },
  });

  const runLifecycle = world.systems.create(lifecycle);
  await world.init();
  runLifecycle();
  await world.destroy();

  assertEquals(calls, ["init", "callback", "destroy"], "Expected system hooks around callback execution");
  assertStrictEquals(world.state, "destroyed", "Expected world to enter destroyed state");
});

Deno.test("query compose supports reusable filters for renderable active movers", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const renderable = new Component<null>({ name: "renderable" });
  const sleeping = new Component<null>({ name: "sleeping" });
  const world = new World({ capacity: 8, components: [position, velocity, renderable, sleeping] });
  await world.init();

  const movingSprite = createEntity(world);
  const sleepingSprite = createEntity(world);
  const invisibleMover = createEntity(world);
  world.components.addToEntity(position, movingSprite);
  world.components.addToEntity(velocity, movingSprite);
  world.components.addToEntity(renderable, movingSprite);
  world.components.addToEntity(position, sleepingSprite);
  world.components.addToEntity(velocity, sleepingSprite);
  world.components.addToEntity(renderable, sleepingSprite);
  world.components.addToEntity(sleeping, sleepingSprite);
  world.components.addToEntity(position, invisibleMover);
  world.components.addToEntity(velocity, invisibleMover);

  const active = new Query({ none: [sleeping] });
  const movers = new Query({ all: [position, velocity] });
  const visible = new Query({ all: [renderable] });
  const activeRenderableMovers = Query.compose([active, movers, visible]);

  assertEquals(
    ids(world.entities.query(activeRenderableMovers)),
    [movingSprite],
    "Expected composed query to combine active, movement, and renderable filters",
  );
});

Deno.test("queryList exposes dense live entity IDs for index-based hot loops", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const sleeping = new Component<null>({ name: "sleeping" });
  const world = new World({ capacity: 8, components: [position, velocity, sleeping] });
  await world.init();

  const first = createEntity(world);
  const second = createEntity(world);
  const third = createEntity(world);
  world.components.addToEntity(position, first);
  world.components.addToEntity(velocity, first);
  world.components.addToEntity(position, second);
  world.components.addToEntity(velocity, second);
  world.components.addToEntity(sleeping, second);
  world.components.addToEntity(position, third);

  const activeMovers = new Query({ all: [position, velocity], none: [sleeping] });
  assertEquals(listIds(world.entities.queryList(activeMovers)), [first], "Expected dense query list to match query");

  world.components.addToEntity(velocity, third);
  assertEquals(
    listIds(world.entities.queryList(activeMovers)),
    [first, third],
    "Expected dense query list to update after component transitions",
  );

  world.entities.destroy(first);
  assertEquals(listIds(world.entities.queryList(activeMovers)), [third], "Expected dense query list to drop destroys");
});

Deno.test("queryList returns a borrowed pooled view, not a stable snapshot", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.addToEntity(position, first);
  world.components.addToEntity(velocity, first);
  world.components.addToEntity(position, second);
  world.components.addToEntity(velocity, second);

  const moving = new Query({ all: [position, velocity] });
  const stale = world.entities.queryList(moving);
  assertEquals(listIds(stale), [first, second], "Expected initial query list to contain both moving entities");

  world.components.removeFromEntity(velocity, second);
  const current = world.entities.queryList(moving);

  assertStrictEquals(stale, current, "Expected invalidated queryList storage to be recycled for the same query");
  assertEquals(listIds(stale), [first], "Expected stale handle to reflect the current recycled result");
});

Deno.test("snapshot helpers return stable arrays across retained and nested use", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.addToEntity(position, first);
  world.components.addToEntity(velocity, first);
  world.components.addToEntity(position, second);
  world.components.addToEntity(velocity, second);

  const moving = new Query({ all: [position, velocity] });
  const retainedQuerySnapshot = world.entities.querySnapshot(moving);
  const retainedOwnersSnapshot = world.components.getOwnersSnapshot(velocity);
  const retainedActiveSnapshot = world.entities.getActiveSnapshot();

  world.components.removeFromEntity(velocity, second);
  const nestedSnapshot = world.entities.querySnapshot(moving);
  world.components.addToEntity(velocity, second);

  assertEquals(retainedQuerySnapshot, [first, second], "Expected retained query snapshot to stay stable");
  assertEquals(retainedOwnersSnapshot, [first, second], "Expected retained owner snapshot to stay stable");
  assertEquals(retainedActiveSnapshot, [first, second], "Expected retained active snapshot to stay stable");
  assertEquals(nestedSnapshot, [first], "Expected nested snapshot to capture its own point in time");
  assertEquals(world.entities.querySnapshot(moving), [first, second], "Expected fresh snapshot to see current state");
});

Deno.test("queryList indices are readonly at the public type boundary", () => {
  const assertReadonlyIndices = (list: QueryEntityList): void => {
    // @ts-expect-error QueryEntityList exposes a borrowed read-only index view.
    list.indices[0] = 1;
  };
  const assertBorrowedAlias = (list: QueryEntityList, iterator: BorrowedEntityIterator): void => {
    const borrowed: BorrowedEntityList = list;
    borrowed.indices[0];
    iterator.next();
  };
  void assertReadonlyIndices;
  void assertBorrowedAlias;
});

Deno.test("batch component transitions mutate dense query lists", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const first = createEntity(world);
  const second = createEntity(world);
  const third = createEntity(world);
  world.components.addToEntity(position, first);
  world.components.addToEntity(position, second);
  world.components.addToEntity(position, third);
  world.components.addToEntity(velocity, second);

  const positioned = new Query({ all: [position] });
  const moving = new Query({ all: [position, velocity] });
  const changed = world.components.addToEntities(velocity, world.entities.queryList(positioned));

  assertEquals(changed, 2, "Expected only entities missing velocity to change ownership");
  assertEquals(
    listIds(world.entities.queryList(moving)).toSorted((a, b) => a - b),
    [first, second, third],
    "Expected all positioned entities to move",
  );

  const removed = world.components.removeFromEntities(velocity, world.entities.queryList(moving));
  assertEquals(removed, 3, "Expected every moving entity to lose velocity");
  assertEquals(listIds(world.entities.queryList(moving)), [], "Expected batch removal to invalidate cached queries");
});

Deno.test("batch component transitions preserve entered and exited visibility until refresh", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.addToEntity(position, first);
  world.components.addToEntity(position, second);
  world.refresh();

  const positioned = new Query({ all: [position] });
  const moving = new Query({ all: [position, velocity] });

  world.components.addToEntities(velocity, world.entities.queryList(positioned), { x: 1, y: 1 });
  assertEquals(
    ids(world.archetypes.queryEntered(moving)).toSorted((a, b) => a - b),
    [first, second],
    "Expected batch-added entities to be visible as entered",
  );

  world.refresh();
  assertEquals(ids(world.archetypes.queryEntered(moving)), [], "Expected refresh to clear batch entered state");

  world.components.removeFromEntities(velocity, world.entities.queryList(moving));
  assertEquals(
    ids(world.archetypes.queryExited(moving)).toSorted((a, b) => a - b),
    [first, second],
    "Expected batch-removed entities to be visible as exited",
  );

  world.refresh();
  assertEquals(ids(world.archetypes.queryExited(moving)), [], "Expected refresh to clear batch exited state");
});

Deno.test("queries remain live across add, remove, destroy, and recreate operations", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = new World({ capacity: 8, components: [position, velocity] });
  await world.init();

  const query = new Query({ all: [position], any: [velocity] });
  const first = createEntity(world);
  world.components.addToEntity(position, first);
  assertEquals(ids(world.entities.query(query)), [], "Expected any clause to require at least one optional component");

  world.components.addToEntity(velocity, first);
  assertEquals(ids(world.entities.query(query)), [first], "Expected entity to enter query after velocity is added");

  world.components.removeFromEntity(velocity, first);
  assertEquals(ids(world.entities.query(query)), [], "Expected entity to leave query after velocity is removed");

  world.components.addToEntity(velocity, first);
  world.entities.destroy(first);
  assertEquals(ids(world.entities.query(query)), [], "Expected destroyed entities to leave cached query results");

  const replacement = createEntity(world);
  world.components.addToEntity(position, replacement);
  world.components.addToEntity(velocity, replacement);
  assertEquals(
    ids(world.entities.query(query)),
    [replacement],
    "Expected recycled entity to enter query with new components",
  );
});

Deno.test("entered and exited query views deduplicate entities that match through multiple archetypes", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const renderable = new Component<null>({ name: "renderable" });
  const world = new World({ capacity: 8, components: [position, velocity, renderable] });
  await world.init();

  const entity = createEntity(world);
  const query = new Query({ any: [position, velocity] });

  world.components.addToEntity(position, entity);
  world.components.addToEntity(velocity, entity);
  world.components.addToEntity(renderable, entity);

  assertEquals(ids(world.entities.query(query)), [entity], "Expected live query to deduplicate entity");
  assertEquals(ids(world.archetypes.queryEntered(query)), [entity], "Expected entered query to deduplicate entity");

  world.refresh();
  world.components.removeFromEntity(renderable, entity);
  world.components.removeFromEntity(velocity, entity);

  assertEquals(ids(world.entities.query(query)), [entity], "Expected entity to still match through position");
  assertEquals(
    ids(world.archetypes.queryExited(query)),
    [],
    "Expected partial component removal to avoid false query exits",
  );
});

Deno.test("world state guards make lifecycle misuse explicit", async () => {
  const position = vec2Component();
  const world = new World({ capacity: 8, components: [position] });
  const query = new Query({ all: [position] });
  const emptyList = { count: 0, indices: new Uint32Array(0) };

  assertThrows(() => world.refresh(), WorldStateError, "World has not been initialized");
  assertThrows(() => world.entities.create(), WorldStateError, "World has not been initialized");
  assertThrows(() => world.entities.destroy(0), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has not been initialized");
  assertThrows(() => world.entities.queryList(query), WorldStateError, "World has not been initialized");
  assertThrows(() => world.components.addToEntity(position, 0), WorldStateError, "World has not been initialized");
  assertThrows(
    () => world.components.addToEntities(position, emptyList),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(() => world.components.removeFromEntity(position, 0), WorldStateError, "World has not been initialized");
  assertThrows(
    () => world.components.removeFromEntities(position, emptyList),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(
    () => world.components.setEntityData(position, 0, { x: 1, y: 2 }),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(() => world.components.query(query), WorldStateError, "World has not been initialized");
  assertThrows(() => world.archetypes.queryComponents(query), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.archetypes.queryEntities(query)), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.archetypes.queryEntered(query)), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.archetypes.queryExited(query)), WorldStateError, "World has not been initialized");

  await world.init();
  await assertRejects(() => world.init(), WorldStateError, "World has already been initialized");
  await world.destroy();
  assertThrows(() => world.refresh(), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.entities.create(), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.entities.destroy(0), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.entities.queryList(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.components.addToEntity(position, 0), WorldStateError, "World has already been destroyed");
  assertThrows(
    () => world.components.addToEntities(position, emptyList),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.removeFromEntity(position, 0),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.removeFromEntities(position, emptyList),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.setEntityData(position, 0, { x: 1, y: 2 }),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(() => world.components.query(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.archetypes.queryComponents(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.archetypes.queryEntities(query)), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.archetypes.queryEntered(query)), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.archetypes.queryExited(query)), WorldStateError, "World has already been destroyed");
  await assertRejects(() => world.onReady(), WorldStateError, 'state is "destroyed"');
});

Deno.test("systems can be registered before init but cannot run outside the initialized lifecycle", async () => {
  const position = vec2Component();
  const calls: string[] = [];
  const world = new World({ capacity: 8, components: [position] });
  const system = new System({
    name: "lifecycleGuarded",
    query: new Query({ all: [position] }),
    init: (hookWorld) => {
      assertStrictEquals(hookWorld.state, "initialized", "Expected init hook to see initialized world state");
      calls.push("init");
    },
    callback: () => {
      calls.push("callback");
    },
  });

  const runSystem = world.systems.create(system);
  assertStrictEquals(world.systems.get(system), runSystem, "Expected pre-init system registration to succeed");
  assertThrows(() => runSystem(), WorldStateError, "World has not been initialized");

  await world.init();
  runSystem();
  await world.destroy();

  assertThrows(() => runSystem(), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.systems.create(system), WorldStateError, "World has already been destroyed");
  await assertRejects(() => world.systems.destroy(system), WorldStateError, "World has already been destroyed");
  assertEquals(calls, ["init", "callback"], "Expected guarded system calls to skip the callback");
});

Deno.test("a component definition can back independent worlds without shared ownership or changed state", async () => {
  const player = new Component<null>({ name: "player", maxEntities: 1 });
  const health = new Component<Health>({ name: "health", schema: { current: Uint16Array, max: Uint16Array } });
  const firstWorld = new World({ capacity: 8, components: [player, health] });
  const secondWorld = new World({ capacity: 8, components: [player, health] });
  await firstWorld.init();
  await secondWorld.init();

  const firstPlayer = createEntity(firstWorld);
  const secondPlayer = createEntity(secondWorld);
  firstWorld.components.addToEntity(player, firstPlayer);
  firstWorld.components.addToEntity(health, firstPlayer, { current: 75, max: 100 });
  secondWorld.components.addToEntity(player, secondPlayer);
  secondWorld.components.addToEntity(health, secondPlayer, { current: 20, max: 25 });

  assertEquals(ids(firstWorld.components.getOwners(player)), [firstPlayer], "Expected first world singleton ownership");
  assertEquals(
    ids(secondWorld.components.getOwners(player)),
    [secondPlayer],
    "Expected second world singleton ownership",
  );
  assertEquals(
    firstWorld.components.getEntityData(health, firstPlayer),
    { current: 75, max: 100 },
    "Expected first data",
  );
  assertEquals(
    secondWorld.components.getEntityData(health, secondPlayer),
    { current: 20, max: 25 },
    "Expected second data",
  );

  firstWorld.refresh();
  assertEquals(ids(firstWorld.components.getChanged(health)), [], "Expected first world changed state to clear");
  assertEquals(
    ids(secondWorld.components.getChanged(health)),
    [secondPlayer],
    "Expected second world changed state to remain",
  );
});

Deno.test("queries support worlds with more than 32 component types", async () => {
  const components = Array.from({ length: 40 }, (_, index) => new Component<null>({ name: `tag${index}` }));
  const world = new World({ capacity: 8, components });
  await world.init();

  const entity = createEntity(world);
  world.components.addToEntity(components[0]!, entity);
  world.components.addToEntity(components[33]!, entity);
  world.components.addToEntity(components[39]!, entity);

  assertEquals(
    ids(world.entities.query(new Query({ all: [components[0]!, components[39]!], none: [components[1]!] }))),
    [entity],
    "Expected bitfields beyond 32 components to participate in queries",
  );
});

Deno.test("high-volume game-loop smoke test keeps query results deterministic under churn", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const sleeping = new Component<null>({ name: "sleeping" });
  const world = new World({ capacity: 2048, components: [position, velocity, sleeping] });
  await world.init();

  const expectedMovers: number[] = [];
  for (let i = 0; i < 1024; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity, { x: i, y: -i });
    if (i % 2 === 0) {
      world.components.addToEntity(velocity, entity, { x: 1, y: 1 });
      if (i % 5 === 0) {
        world.components.addToEntity(sleeping, entity);
      } else {
        expectedMovers.push(entity);
      }
    }
  }

  const activeMovers = new Query({ all: [position, velocity], none: [sleeping] });
  assertEquals(ids(world.entities.query(activeMovers)), expectedMovers, "Expected deterministic active mover query");

  for (const entity of expectedMovers.slice(0, 64)) {
    world.components.removeFromEntity(velocity, entity);
  }

  assertEquals(
    ids(world.entities.query(activeMovers)),
    expectedMovers.slice(64),
    "Expected query cache invalidation to handle repeated component churn",
  );
});
