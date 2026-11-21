/// <reference lib="deno.ns" />

import {
  asEntity,
  Component,
  entityIndex,
  EntityNotFoundError,
  Query,
  System,
  World,
  WorldStateError,
} from "../mod.ts";
import type { BorrowedEntityIterator, BorrowedEntityList, ComponentInstance, QueryEntityList } from "../mod.ts";
import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows, ids, listIds } from "./helpers.ts";
import { createEntity, createTestWorld, tagComponent, type Vec2, vec2Component } from "./fixtures.ts";

type Health = { current: Uint16ArrayConstructor; max: Uint16ArrayConstructor };

Deno.test("world enforces entity capacity and reuses destroyed entity slots without stale components", async () => {
  const position = vec2Component();
  const renderable = tagComponent("renderable");
  const world = await createTestWorld([position, renderable]);

  const entities = Array.from({ length: 8 }, () => createEntity(world));
  const first = entities[0]!;
  const second = entities[1]!;
  const third = entities[2]!;
  assertStrictEquals(world.entities.create(), undefined, "Expected create() to return undefined when capacity is full");

  world.components.add(position, second, { x: 10, y: 20 });
  world.components.add(renderable, second);
  assertEquals(ids(world.entities.query(new Query({ all: [position, renderable] }))), [second], "Expected setup match");

  world.entities.destroy(second);

  assertEquals(
    ids(world.entities.getActive()),
    [first, third, ...entities.slice(3)],
    "Expected destroyed entity to leave active iteration",
  );
  assertEquals(ids(world.entities.query(new Query({ all: [position] }))), [], "Expected destroy to remove components");
  assertEquals(ids(world.components.getOwners(position)), [], "Expected destroy to clear component ownership");
  assert(!world.entities.isEmpty(second), "Expected destroyed entity to leave archetype membership");

  const replacement = createEntity(world);
  assertStrictEquals(
    entityIndex(replacement),
    entityIndex(second),
    "Expected entity slots to be recycled for stable, allocation-free gameplay loops",
  );
  assert(
    !world.entities.isActive(second),
    "Expected the destroyed packed handle to become stale after slot reuse",
  );
  assert(
    !world.components.has(position, replacement),
    "Expected recycled entity to start without stale components",
  );

  world.components.add(position, replacement);
  assertEquals(
    world.components.getDataOrThrow(position, replacement),
    { x: 0, y: 0 },
    "Expected recycled component storage to be reinitialized when ownership is reacquired",
  );
});

Deno.test("component data APIs expose initial data, mutation, and per-frame dense changed tracking", async () => {
  const position = vec2Component();
  const renderable = tagComponent("renderable");
  const world = await createTestWorld([position, renderable]);

  const entity = createEntity(world);
  world.components.add(position, entity, { x: 1.5, y: -2 });
  world.components.add(renderable, entity);

  assertEquals(
    world.components.getDataOrThrow(position, entity),
    { x: 1.5, y: -2 },
    "Expected initial data to be stored",
  );
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected add to mark component changed");
  assertEquals(
    ids(world.components.getChanged(renderable)),
    [],
    "Expected tag components to stay out of changed state",
  );

  world.refresh();
  assertEquals(ids(world.components.getChanged(position)), [], "Expected refresh to clear changed tracking");

  world.components.setData(position, entity, { x: 4, y: 9 });

  assertEquals(
    world.components.getDataOrThrow(position, entity),
    { x: 4, y: 9 },
    "Expected setData to update storage",
  );
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected setData to mark changed entities");
});

Deno.test("component proxy tracks only real writes and direct storage access remains an opt-out fast path", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);

  const entity = createEntity(world);
  world.components.add(position, entity, { x: 0, y: 0 });
  const instance = world.components.getInstance(position);
  assert(instance !== undefined, "Expected component instance to exist");
  const storage = instance.storage;
  const proxy = instance.proxy;
  assert(storage !== null && proxy !== null, "Expected component instance with proxy and storage");

  world.refresh();
  storage.partitions.x[entityIndex(entity)] = 99;
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
    world.components.getDataOrThrow(position, entity),
    { x: 99, y: 100 },
    "Expected proxy write to update data",
  );
  assertEquals(ids(world.components.getChanged(position)), [entity], "Expected proxy writes to mark changed entities");
});

Deno.test("changed iteration reuses dense storage and tracks each entity once per frame", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.add(position, first, { x: 0, y: 0 });
  world.components.add(position, second, { x: 1, y: 1 });
  world.refresh();

  const instance = world.components.getInstance(position);
  assert(instance !== undefined && instance.proxy !== null, "Expected data component instance");

  world.components.setData(position, first, { x: 2, y: 2 });
  world.components.setData(position, first, { x: 3, y: 3 });
  instance.proxy.entity = first;
  instance.proxy.x = 4;
  instance.proxy.y = 5;
  world.components.setData(position, second, { x: 6, y: 6 });

  const firstRead = world.components.getChanged(position);
  const secondRead = world.components.getChanged(position);

  assert(firstRead !== undefined && secondRead !== undefined, "Expected changed iterator for registered component");
  assertStrictEquals(secondRead, firstRead, "Expected getChanged to reuse the component's borrowed iterator");
  assertEquals(ids(firstRead), [first, second], "Expected one dense changed entry per entity");

  world.components.remove(position, first);
  assertEquals(ids(world.components.getChanged(position)), [second], "Expected removal to erase changed membership");

  world.refresh();
  assertEquals(ids(world.components.getChanged(position)), [], "Expected refresh to reset dense changed count");
});

Deno.test("proxy rejects out-of-range entity targets before mutating component storage", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);

  const instance = world.components.getInstance(position);
  assert(instance !== undefined, "Expected component instance to exist");
  const proxy = instance.proxy;
  assert(proxy !== null, "Expected component proxy to exist");

  assertThrows(
    () => {
      proxy.entity = asEntity(8);
    },
    EntityNotFoundError,
    "Entity 8 is out of range.",
  );
});

Deno.test("manual typed query and system expose keyed component instances in callbacks", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  world.components.add(position, first, { x: 1, y: 2 });
  world.components.add(velocity, first, { x: 3, y: 4 });

  const movement = new System({
    name: "movement",
    query: new Query({ all: { position, velocity } }),
    callback: (components, entities, dt: number) => {
      for (let i = 0; i < entities.count; i++) {
        const slot = entities.slots[i]!;
        components.position.storage.partitions.x[slot] = components.position.storage.partitions.x[slot]! +
          components.velocity.storage.partitions.x[slot]! * dt;
        components.position.storage.partitions.y[slot] = components.position.storage.partitions.y[slot]! +
          components.velocity.storage.partitions.y[slot]! * dt;
      }
    },
  });

  const updateMovement = world.systems.register(movement);
  updateMovement(2);
  assertEquals(
    world.components.getDataOrThrow(position, first),
    { x: 7, y: 10 },
    "Expected typed manual system update",
  );
});

Deno.test("equivalent query filters preserve distinct callback component keys", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);

  ids(world.entities.query(new Query({ all: { position } })));
  const positionInstance = world.components.getInstanceOrThrow(position);
  let callbackRan = false;
  const aliasedMovement = new System({
    name: "aliasedMovement",
    query: new Query({ all: { pos: position } }),
    callback: (components) => {
      callbackRan = true;
      assertStrictEquals(components.pos, positionInstance, "Expected later query's authored key to be preserved");
      assertEquals("position" in components, false, "Expected previous query's callback key not to leak");
    },
  });

  world.systems.register(aliasedMovement)();
  assert(callbackRan, "Expected aliased system callback to run");
});

Deno.test("systems receive matching component instances, borrowed entity lists, and frame arguments", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  world.components.add(position, first, { x: 10, y: 20 });
  world.components.add(velocity, first, { x: 1, y: -2 });

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
        const slot = entities.slots[i]!;
        const nextX = (positionStore.partitions.x[slot] ?? Number.NaN) +
          (velocityStore.partitions.x[slot] ?? Number.NaN) * dt;
        const nextY = (positionStore.partitions.y[slot] ?? Number.NaN) +
          (velocityStore.partitions.y[slot] ?? Number.NaN) * dt;
        positionStore.partitions.x[slot] = nextX;
        positionStore.partitions.y[slot] = nextY;
      }
    },
  });

  const updateMovement = world.systems.register(movement);
  updateMovement(2);
  assertEquals(
    world.components.getDataOrThrow(position, first),
    { x: 12, y: 16 },
    "Expected first movement update",
  );

  const second = createEntity(world);
  world.components.add(position, second, { x: 0, y: 0 });
  world.components.add(velocity, second, { x: 3, y: 4 });

  updateMovement(1);

  assertEquals(
    ids(world.entities.query(new Query({ all: [position, velocity] }))),
    [first, second],
    "Expected system query to see entities added after system creation",
  );
  assertEquals(
    world.components.getDataOrThrow(position, first),
    { x: 13, y: 14 },
    "Expected first entity to update again",
  );
  assertEquals(
    world.components.getDataOrThrow(position, second),
    { x: 3, y: 4 },
    "Expected second entity to update",
  );
  assertStrictEquals(world.systems.get(movement), updateMovement, "Expected systems to be retrievable by prototype");
  assertStrictEquals(world.systems.get("movement"), updateMovement, "Expected systems to be retrievable by name");
});

Deno.test("typed systems receive keyed component records and borrowed entity lists", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  world.components.add(position, first, { x: 1, y: 2 });
  world.components.add(velocity, first, { x: 3, y: 4 });

  const seen: number[][] = [];
  const movement = new System({
    name: "typedMovement",
    query: new Query({ all: { position, velocity } }),
    callback: (components, entities, dt: number) => {
      const current = listIds(entities);
      seen.push(current);
      const positionStorage = components.position.storage;
      const velocityStorage = components.velocity.storage;
      assert(positionStorage !== null && velocityStorage !== null, "Expected data components to have storage");
      for (let i = 0; i < entities.count; i++) {
        const slot = entities.slots[i]!;
        positionStorage.partitions.x[slot] = (positionStorage.partitions.x[slot] ?? 0) +
          (velocityStorage.partitions.x[slot] ?? 0) * dt;
      }
    },
  });

  const updateMovement = world.systems.register(movement);
  updateMovement(2);

  const second = createEntity(world);
  world.components.add(position, second, { x: 10, y: 0 });
  world.components.add(velocity, second, { x: 1, y: 0 });
  updateMovement(1);

  assertEquals(seen, [[first], [first, second]], "Expected each invocation to receive a fresh entity iterator");
  assertEquals(
    world.components.getDataOrThrow(position, first),
    { x: 10, y: 2 },
    "Expected first entity updates",
  );
  assertEquals(
    world.components.getDataOrThrow(position, second),
    { x: 11, y: 0 },
    "Expected second entity updates",
  );
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

  const runLifecycle = world.systems.register(lifecycle);
  await world.init();
  runLifecycle();
  await world.destroy();

  assertEquals(calls, ["init", "callback", "destroy"], "Expected system hooks around callback execution");
  assertStrictEquals(world.state, "destroyed", "Expected world to enter destroyed state");
});

Deno.test("systems created after world initialization run their init hook", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  let initCount = 0;

  world.systems.register(
    new System({
      name: "lateSystem",
      query: new Query({ all: [position] }),
      init: () => {
        initCount++;
      },
      callback: () => {},
    }),
  );

  assertEquals(initCount, 1, "Expected late-created system init hook to run immediately");
});

Deno.test("late async system init rejection moves the world into error state", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const lateSystem = new System({
    name: "lateAsyncFailure",
    query: new Query({ all: [position] }),
    init: async () => {
      await Promise.resolve();
      throw new Error("late init failed");
    },
    callback: () => {},
  });

  world.systems.register(lateSystem);
  await Promise.resolve();
  await Promise.resolve();

  assertEquals(world.state, "error", "Expected async late init failure to poison the world");
  assert(!world.systems.has(lateSystem), "Expected failed late-created system to be rolled back");
  assertThrows(() => world.entities.create(), WorldStateError, "World has encountered an error");
});

Deno.test("late async system init rejection is ignored after the system is destroyed", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  let rejectInit!: (error: unknown) => void;
  const initPromise = new Promise<void>((_, reject) => {
    rejectInit = reject;
  });
  const lateSystem = new System({
    name: "lateStaleAsyncFailure",
    query: new Query({ all: [position] }),
    init: () => initPromise,
    callback: () => {},
  });

  world.systems.register(lateSystem);
  // Destroying a system waits for its pending init; the init failure is moot once the system is discarded.
  const destruction = world.systems.destroy(lateSystem);
  rejectInit(new Error("stale late init failed"));
  await destruction;
  await Promise.resolve();
  await Promise.resolve();

  assertEquals(world.state, "initialized", "Expected stale late init failure not to poison the world");
  assert(!world.systems.has(lateSystem), "Expected destroyed late-created system to stay unregistered");
  world.entities.createOrThrow();
});

Deno.test("late synchronous system init failure rolls back registration and poisons the world", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const lateSystem = new System({
    name: "lateSyncFailure",
    query: new Query({ all: [position] }),
    init: () => {
      throw new Error("late sync init failed");
    },
    callback: () => {},
  });

  assertThrows(() => world.systems.register(lateSystem), Error, "late sync init failed");
  assertEquals(world.state, "error", "Expected synchronous late init failure to poison the world");
  assert(!world.systems.has(lateSystem), "Expected failed late-created system to be rolled back");
});

Deno.test("query compose supports reusable filters for renderable active movers", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const renderable = tagComponent("renderable");
  const sleeping = tagComponent("sleeping");
  const world = await createTestWorld([position, velocity, renderable, sleeping]);

  const movingSprite = createEntity(world);
  const sleepingSprite = createEntity(world);
  const invisibleMover = createEntity(world);
  world.components.add(position, movingSprite);
  world.components.add(velocity, movingSprite);
  world.components.add(renderable, movingSprite);
  world.components.add(position, sleepingSprite);
  world.components.add(velocity, sleepingSprite);
  world.components.add(renderable, sleepingSprite);
  world.components.add(sleeping, sleepingSprite);
  world.components.add(position, invisibleMover);
  world.components.add(velocity, invisibleMover);

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
  const sleeping = tagComponent("sleeping");
  const world = await createTestWorld([position, velocity, sleeping]);

  const first = createEntity(world);
  const second = createEntity(world);
  const third = createEntity(world);
  world.components.add(position, first);
  world.components.add(velocity, first);
  world.components.add(position, second);
  world.components.add(velocity, second);
  world.components.add(sleeping, second);
  world.components.add(position, third);

  const activeMovers = new Query({ all: [position, velocity], none: [sleeping] });
  assertEquals(listIds(world.entities.queryList(activeMovers)), [first], "Expected dense query list to match query");

  world.components.add(velocity, third);
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
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.add(position, first);
  world.components.add(velocity, first);
  world.components.add(position, second);
  world.components.add(velocity, second);

  const moving = new Query({ all: [position, velocity] });
  const stale = world.entities.queryList(moving);
  assertEquals(listIds(stale), [first, second], "Expected initial query list to contain both moving entities");

  world.components.remove(velocity, second);
  const current = world.entities.queryList(moving);

  assertStrictEquals(stale, current, "Expected invalidated queryList storage to be recycled for the same query");
  assertEquals(listIds(stale), [first], "Expected stale handle to reflect the current recycled result");
});

Deno.test("snapshot helpers return stable arrays across retained and nested use", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.add(position, first);
  world.components.add(velocity, first);
  world.components.add(position, second);
  world.components.add(velocity, second);

  const moving = new Query({ all: [position, velocity] });
  const retainedQuerySnapshot = Array.from(world.entities.query(moving));
  const retainedOwnersSnapshot = Array.from(world.components.getOwners(velocity));
  const retainedActiveSnapshot = Array.from(world.entities.getActive());

  world.components.remove(velocity, second);
  const nestedSnapshot = Array.from(world.entities.query(moving));
  world.components.add(velocity, second);

  assertEquals(retainedQuerySnapshot, [first, second], "Expected retained query snapshot to stay stable");
  assertEquals(retainedOwnersSnapshot, [first, second], "Expected retained owner snapshot to stay stable");
  assertEquals(retainedActiveSnapshot, [first, second], "Expected retained active snapshot to stay stable");
  assertEquals(nestedSnapshot, [first], "Expected nested snapshot to capture its own point in time");
  assertEquals(
    Array.from(world.entities.query(moving)),
    [first, second],
    "Expected fresh snapshot to see current state",
  );
});

Deno.test("queryList slots are readonly at the public type boundary", () => {
  const assertReadonlyIndices = (list: QueryEntityList): void => {
    // @ts-expect-error QueryEntityList exposes a borrowed read-only index view.
    list.slots[0] = 1;
  };
  const assertBorrowedSubtype = (list: BorrowedEntityList, iterator: BorrowedEntityIterator): void => {
    // Borrowed (iterable) lists remain valid inputs for the minimal batch list shape.
    const minimal: QueryEntityList = list;
    minimal.slots[0];
    iterator.next();
  };
  void assertReadonlyIndices;
  void assertBorrowedSubtype;
});

Deno.test("batch component transitions mutate dense query lists", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  const second = createEntity(world);
  const third = createEntity(world);
  world.components.add(position, first);
  world.components.add(position, second);
  world.components.add(position, third);
  world.components.add(velocity, second);

  const positioned = new Query({ all: [position] });
  const moving = new Query({ all: [position, velocity] });
  const changed = world.components.addMany(velocity, world.entities.queryList(positioned));

  assertEquals(changed, 2, "Expected only entities missing velocity to change ownership");
  assertEquals(
    listIds(world.entities.queryList(moving)).toSorted((a, b) => a - b),
    [first, second, third],
    "Expected all positioned entities to move",
  );

  const removed = world.components.removeMany(velocity, world.entities.queryList(moving));
  assertEquals(removed, 3, "Expected every moving entity to lose velocity");
  assertEquals(listIds(world.entities.queryList(moving)), [], "Expected batch removal to invalidate cached queries");
});

Deno.test("batch component transitions preserve entered and exited visibility until refresh", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const first = createEntity(world);
  const second = createEntity(world);
  world.components.add(position, first);
  world.components.add(position, second);
  world.refresh();

  const positioned = new Query({ all: [position] });
  const moving = new Query({ all: [position, velocity] });

  world.components.addMany(velocity, world.entities.queryList(positioned), { x: 1, y: 1 });
  assertEquals(
    ids(world.entities.queryEntered(moving)).toSorted((a, b) => a - b),
    [first, second],
    "Expected batch-added entities to be visible as entered",
  );

  world.refresh();
  assertEquals(ids(world.entities.queryEntered(moving)), [], "Expected refresh to clear batch entered state");

  world.components.removeMany(velocity, world.entities.queryList(moving));
  assertEquals(
    ids(world.entities.queryExited(moving)).toSorted((a, b) => a - b),
    [first, second],
    "Expected batch-removed entities to be visible as exited",
  );

  world.refresh();
  assertEquals(ids(world.entities.queryExited(moving)), [], "Expected refresh to clear batch exited state");
});

Deno.test("queries remain live across add, remove, destroy, and recreate operations", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity]);

  const query = new Query({ all: [position], any: [velocity] });
  const first = createEntity(world);
  world.components.add(position, first);
  assertEquals(ids(world.entities.query(query)), [], "Expected any clause to require at least one optional component");

  world.components.add(velocity, first);
  assertEquals(ids(world.entities.query(query)), [first], "Expected entity to enter query after velocity is added");

  world.components.remove(velocity, first);
  assertEquals(ids(world.entities.query(query)), [], "Expected entity to leave query after velocity is removed");

  world.components.add(velocity, first);
  world.entities.destroy(first);
  assertEquals(ids(world.entities.query(query)), [], "Expected destroyed entities to leave cached query results");

  const replacement = createEntity(world);
  world.components.add(position, replacement);
  world.components.add(velocity, replacement);
  assertEquals(
    ids(world.entities.query(query)),
    [replacement],
    "Expected recycled entity to enter query with new components",
  );
});

Deno.test("entered and exited query views deduplicate entities that match through multiple archetypes", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const renderable = tagComponent("renderable");
  const world = await createTestWorld([position, velocity, renderable]);

  const entity = createEntity(world);
  const query = new Query({ any: [position, velocity] });

  world.components.add(position, entity);
  world.components.add(velocity, entity);
  world.components.add(renderable, entity);

  assertEquals(ids(world.entities.query(query)), [entity], "Expected live query to deduplicate entity");
  assertEquals(ids(world.entities.queryEntered(query)), [entity], "Expected entered query to deduplicate entity");

  world.refresh();
  world.components.remove(renderable, entity);
  world.components.remove(velocity, entity);

  assertEquals(ids(world.entities.query(query)), [entity], "Expected entity to still match through position");
  assertEquals(
    ids(world.entities.queryExited(query)),
    [],
    "Expected partial component removal to avoid false query exits",
  );
});

Deno.test("world state guards make lifecycle misuse explicit", async () => {
  const position = vec2Component();
  const world = new World({ capacity: 8, components: [position] });
  const query = new Query({ all: [position] });
  const emptyList = { count: 0, entities: new Uint32Array(0), slots: new Uint32Array(0) };

  assertThrows(() => world.refresh(), WorldStateError, "World has not been initialized");
  assertThrows(() => world.entities.create(), WorldStateError, "World has not been initialized");
  assertThrows(() => world.entities.destroy(asEntity(0)), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has not been initialized");
  assertThrows(() => world.entities.queryList(query), WorldStateError, "World has not been initialized");
  assertThrows(
    () => world.components.add(position, asEntity(0)),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(
    () => world.components.addMany(position, emptyList),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(
    () => world.components.remove(position, asEntity(0)),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(
    () => world.components.removeMany(position, emptyList),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(
    () => world.components.setData(position, asEntity(0), { x: 1, y: 2 }),
    WorldStateError,
    "World has not been initialized",
  );
  assertThrows(() => world.components.query(query), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.entities.queryEntered(query)), WorldStateError, "World has not been initialized");
  assertThrows(() => ids(world.entities.queryExited(query)), WorldStateError, "World has not been initialized");

  await world.init();
  await assertRejects(() => world.init(), WorldStateError, "World has already been initialized");
  await world.destroy();
  assertThrows(() => world.refresh(), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.entities.create(), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.entities.destroy(asEntity(0)), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.entities.queryList(query), WorldStateError, "World has already been destroyed");
  assertThrows(
    () => world.components.add(position, asEntity(0)),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.addMany(position, emptyList),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.remove(position, asEntity(0)),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.removeMany(position, emptyList),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(
    () => world.components.setData(position, asEntity(0), { x: 1, y: 2 }),
    WorldStateError,
    "World has already been destroyed",
  );
  assertThrows(() => world.components.query(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.entities.query(query)), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.entities.queryEntered(query)), WorldStateError, "World has already been destroyed");
  assertThrows(() => ids(world.entities.queryExited(query)), WorldStateError, "World has already been destroyed");
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

  const runSystem = world.systems.register(system);
  assertStrictEquals(world.systems.get(system), runSystem, "Expected pre-init system registration to succeed");
  assertThrows(() => runSystem(), WorldStateError, "World has not been initialized");

  await world.init();
  runSystem();
  await world.destroy();

  assertThrows(() => runSystem(), WorldStateError, "World has already been destroyed");
  assertThrows(() => world.systems.register(system), WorldStateError, "World has already been destroyed");
  await assertRejects(() => world.systems.destroy(system), WorldStateError, "World has already been destroyed");
  assertEquals(calls, ["init", "callback"], "Expected guarded system calls to skip the callback");
});

Deno.test("captured lifecycle API methods observe the current world state", async () => {
  const position = vec2Component();
  const world = new World({ capacity: 8, components: [position] });
  const query = new Query({ all: [position] });
  const system = new System({
    name: "capturedLifecycle",
    query,
    callback: () => {},
  });

  await world.init();

  const createEntity = world.entities.create;
  const queryList = world.entities.queryList;
  const add = world.components.add;
  const queryComponents = world.components.query;
  const queryEntered = world.entities.queryEntered;
  const registerSystem = world.systems.register;
  const destroySystem = world.systems.destroy;

  await world.destroy();

  assertThrows(() => createEntity(), WorldStateError, "World has already been destroyed");
  assertThrows(() => queryList(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => add(position, asEntity(0)), WorldStateError, "World has already been destroyed");
  assertThrows(() => queryComponents(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => queryEntered(query), WorldStateError, "World has already been destroyed");
  assertThrows(() => registerSystem(system), WorldStateError, "World has already been destroyed");
  await assertRejects(() => destroySystem(system), WorldStateError, "World has already been destroyed");
});

Deno.test("a component definition can back independent worlds without shared ownership or changed state", async () => {
  const player = tagComponent("player", { maxOwners: 1 });
  const health = new Component<Health>({ name: "health", schema: { current: Uint16Array, max: Uint16Array } });
  const firstWorld = new World({ capacity: 8, components: [player, health] });
  const secondWorld = new World({ capacity: 8, components: [player, health] });
  await firstWorld.init();
  await secondWorld.init();

  const firstPlayer = createEntity(firstWorld);
  const secondPlayer = createEntity(secondWorld);
  firstWorld.components.add(player, firstPlayer);
  firstWorld.components.add(health, firstPlayer, { current: 75, max: 100 });
  secondWorld.components.add(player, secondPlayer);
  secondWorld.components.add(health, secondPlayer, { current: 20, max: 25 });

  assertEquals(ids(firstWorld.components.getOwners(player)), [firstPlayer], "Expected first world singleton ownership");
  assertEquals(
    ids(secondWorld.components.getOwners(player)),
    [secondPlayer],
    "Expected second world singleton ownership",
  );
  assertEquals(
    firstWorld.components.getDataOrThrow(health, firstPlayer),
    { current: 75, max: 100 },
    "Expected first data",
  );
  assertEquals(
    secondWorld.components.getDataOrThrow(health, secondPlayer),
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
  world.components.add(components[0]!, entity);
  world.components.add(components[33]!, entity);
  world.components.add(components[39]!, entity);

  assertEquals(
    ids(world.entities.query(new Query({ all: [components[0]!, components[39]!], none: [components[1]!] }))),
    [entity],
    "Expected bitfields beyond 32 components to participate in queries",
  );
});

Deno.test("high-volume game-loop smoke test keeps query results deterministic under churn", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const sleeping = tagComponent("sleeping");
  const world = await createTestWorld([position, velocity, sleeping], 2048);

  const expectedMovers: ReturnType<typeof createEntity>[] = [];
  for (let i = 0; i < 1024; i++) {
    const entity = createEntity(world);
    world.components.add(position, entity, { x: i, y: -i });
    if (i % 2 === 0) {
      world.components.add(velocity, entity, { x: 1, y: 1 });
      if (i % 5 === 0) {
        world.components.add(sleeping, entity);
      } else {
        expectedMovers.push(entity);
      }
    }
  }

  const activeMovers = new Query({ all: [position, velocity], none: [sleeping] });
  assertEquals(ids(world.entities.query(activeMovers)), expectedMovers, "Expected deterministic active mover query");

  for (const entity of expectedMovers.slice(0, 64)) {
    world.components.remove(velocity, entity);
  }

  assertEquals(
    ids(world.entities.query(activeMovers)).sort((a, b) => a - b),
    expectedMovers.slice(64),
    "Expected query cache invalidation to handle repeated component churn",
  );
});
