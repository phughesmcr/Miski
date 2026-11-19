/// <reference lib="deno.ns" />

import {
  CapacityError,
  captureWorldRollbackPoint,
  Component,
  ComponentDataError,
  createEcsWorld,
  defineComponentSchema,
  type DynamicComponent,
  type Entity,
  entityIndex,
  NotRegisteredError,
  Prefab,
  Query,
  restoreWorldRollbackPoint,
  World,
  WorldStateError,
} from "../mod.ts";
import type { ComponentBundleEntryInput } from "../mod.ts";
import { createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

const healthSchema = defineComponentSchema({ hp: Uint16Array, maxHp: Uint16Array });
const statsSchema = defineComponentSchema({ level: Uint8Array, speed: Float32Array });

const position = vec2Component("position");
const velocity = vec2Component("velocity");
const health = new Component({ name: "health", schema: healthSchema });
const stats = new Component({ name: "stats", schema: statsSchema });
const boss = new Component({ name: "bossStats", schema: statsSchema, maxEntities: 2 });
const enemy = tagComponent("enemy");
const flying = tagComponent("flying");
const leader = tagComponent("leader", { maxEntities: 1 });

const allComponents: DynamicComponent[] = [position, velocity, health, stats, boss, enemy, flying, leader];

const queries = [
  new Query({ all: [position] }),
  new Query({ all: [enemy], none: [flying] }),
  new Query({ any: [health, stats] }),
  new Query({ none: [enemy] }),
];

const goblin = new Prefab({
  name: "goblin",
  components: [
    [position, { x: 1.5, y: -2 }],
    [health, { hp: 10, maxHp: 10 }],
    [stats, { level: 3 }],
    [enemy],
  ],
});

/** The bundle that `createWith` must receive to match `goblin` exactly. */
const goblinBundle = [
  [position, { x: 1.5, y: -2 }],
  [health, { hp: 10, maxHp: 10 }],
  [stats, { level: 3 }],
  [enemy],
] as const;

/**
 * Everything observable about a world, in iteration order. Revision tokens are excluded on request: rollback
 * restore moves them forward by design.
 */
function observe(world: World, revisions = true): unknown {
  const owners: Record<string, number[]> = {};
  const changed: Record<string, number[]> = {};
  const data: Record<string, Record<string, unknown>> = {};
  for (const component of allComponents) {
    owners[component.name] = world.components.getOwnersSnapshot(component) ?? [];
    changed[component.name] = world.components.getChangedSnapshot(component) ?? [];
    if (component.schema === null) continue;
    const rows: Record<string, unknown> = {};
    for (const entity of owners[component.name]!) {
      rows[entity] = world.components.getEntityData(component as Component<never>, entity as Entity);
    }
    data[component.name] = rows;
  }
  return {
    active: world.entities.getActiveSnapshot(),
    owners,
    changed,
    data,
    queries: queries.map((query) => ({
      list: world.entities.querySnapshot(query),
      entered: [...world.entities.queryEntered(query)],
      exited: [...world.entities.queryExited(query)],
      revision: revisions ? world.queryRevision(query) : 0,
    })),
  };
}

/** Next handle a world would allocate, observed by allocating and destroying it. */
function peekNextHandle(world: World): Entity {
  const entity = world.entities.createOrThrow();
  world.entities.destroy(entity);
  return entity;
}

async function twinWorlds(capacity = 32): Promise<[World, World]> {
  return [await createTestWorld(allComponents, capacity), await createTestWorld(allComponents, capacity)];
}

/** Churn a world identically so allocation is not trivially sequential. */
function churn(world: World): void {
  const a = world.entities.createWithOrThrow([[position, { x: 9, y: 9 }]]);
  const b = world.entities.createWithOrThrow([[enemy], [flying]]);
  world.entities.createWithOrThrow([[velocity, { x: 1, y: 1 }]]);
  world.refresh();
  world.entities.destroy(a);
  world.entities.destroy(b);
}

// --- Definition ---

Deno.test("Prefab definition exposes flattened components and frozen canonical defaults", () => {
  assertStrictEquals(goblin.name, "goblin", "name");
  assertEquals(goblin.components.map((c) => c.name), ["position", "health", "stats", "enemy"], "component order");
  assert(goblin.has(enemy) && goblin.has(health) && !goblin.has(velocity), "has");
  assertEquals(goblin.get(position), { x: 1.5, y: -2 }, "position defaults");
  // Unspecified fields default to zero, exactly as a new owner would.
  assertEquals(goblin.get(stats), { level: 3, speed: 0 }, "partial defaults fill with zero");
  assertStrictEquals(goblin.get(enemy), null, "tags have no data");
  assertStrictEquals(goblin.get(velocity), undefined, "absent component");
  assert(Object.isFrozen(goblin), "prefab frozen");
  assert(Object.isFrozen(goblin.components), "components frozen");
  assert(Object.isFrozen(goblin.get(position)), "defaults frozen");
});

Deno.test("Prefab canonicalizes defaults through each field's typed array", () => {
  const prefab = new Prefab({ components: [[stats, { level: 300, speed: 0.1 }], [position, { x: -0, y: 1 }]] });
  assertEquals(prefab.get(stats), { level: 44, speed: Math.fround(0.1) }, "Uint8 wraps and Float32 rounds");
  assert(Object.is(prefab.get(position)!.x, 0), "negative zero canonicalizes to zero");
});

Deno.test("Prefab copies input data so later caller mutations do not leak in", () => {
  const input = { x: 1, y: 2 };
  const prefab = new Prefab({ components: [[position, input]] });
  input.x = 100;
  assertEquals(prefab.get(position), { x: 1, y: 2 }, "definition data is copied");
});

Deno.test("Prefab extends flattens the parent first and merges overridden fields", () => {
  const goblinBoss = new Prefab({
    name: "goblinBoss",
    extends: goblin,
    components: [[health, { hp: 500 }], [leader], [velocity, { x: 2 }]],
  });
  assertStrictEquals(goblinBoss.parent, goblin, "parent");
  assertEquals(
    goblinBoss.components.map((c) => c.name),
    ["position", "health", "stats", "enemy", "leader", "velocity"],
    "parent components keep their order, new ones are appended",
  );
  assertEquals(goblinBoss.get(health), { hp: 500, maxHp: 10 }, "child fields override, parent fields remain");
  assertEquals(goblinBoss.get(position), { x: 1.5, y: -2 }, "inherited unchanged");
  assertEquals(goblinBoss.get(velocity), { x: 2, y: 0 }, "new component");
  assertEquals(goblin.get(health), { hp: 10, maxHp: 10 }, "parent is unaffected");

  const grandchild = new Prefab({ extends: goblinBoss, components: [[health, { maxHp: 999 }]] });
  assertEquals(grandchild.get(health), { hp: 500, maxHp: 999 }, "multi-level inheritance merges in order");
  const empty = new Prefab({ extends: goblin, components: [] });
  assertEquals(empty.components.map((c) => c.name), goblin.components.map((c) => c.name), "empty child");
});

Deno.test("Prefab rejects invalid definitions", () => {
  assertThrows(() => new Prefab({ components: [[position, { z: 1 }]] } as never), ComponentDataError, "z");
  assertThrows(() => new Prefab({ components: [[position, { x: Number.NaN }]] }), ComponentDataError, "finite");
  assertThrows(() => new Prefab({ components: [[position, { x: "1" }]] } as never), ComponentDataError, "finite");
  assertThrows(() => new Prefab({ components: [[enemy, {}]] } as never), ComponentDataError, "no data storage");
  assertThrows(() => new Prefab({ components: [[enemy], [enemy]] }), RangeError, "Duplicate");
  assertThrows(() => new Prefab({ components: [[position, { x: 1e300 }]] }), TypeError, "storage range");
  assertThrows(() => new Prefab({ components: [position] } as never), TypeError, "tuple");
  assertThrows(() => new Prefab({ components: [[{}]] } as never), TypeError, "Component");
  assertThrows(() => new Prefab({ components: {} } as never), TypeError, "array");
  assertThrows(() => new Prefab({ extends: {}, components: [] } as never), TypeError, "Prefab");
});

// --- Single instantiate ---

Deno.test("instantiate matches an equivalent createWith in every observable", async () => {
  const [a, b] = await twinWorlds();
  churn(a);
  churn(b);
  for (let i = 0; i < 3; i++) {
    const viaPrefab = a.entities.instantiate(goblin);
    const viaBundle = b.entities.createWith(goblinBundle);
    assertStrictEquals(viaPrefab, viaBundle, `handle ${i}`);
  }
  assertEquals(observe(a), observe(b), "worlds diverged after instantiate");
  a.refresh();
  b.refresh();
  assertEquals(observe(a), observe(b), "worlds diverged after refresh");
  assertStrictEquals(peekNextHandle(a), peekNextHandle(b), "next allocation");
});

Deno.test("instantiate merges per-field overrides over prefab defaults and may add components", async () => {
  const [a, b] = await twinWorlds();
  const overrides = [[position, { x: 7 }], [velocity, { y: 3 }], [flying]] as const;
  const e = a.entities.instantiateOrThrow(goblin, overrides);
  const twin = b.entities.createWithOrThrow([
    [position, { x: 7, y: -2 }],
    [health, { hp: 10, maxHp: 10 }],
    [stats, { level: 3 }],
    [enemy],
    [velocity, { y: 3 }],
    [flying],
  ]);
  assertStrictEquals(e, twin, "handle");
  assertEquals(a.components.getEntityData(position, e), { x: 7, y: -2 }, "unspecified field keeps prefab default");
  assertEquals(a.components.getEntityData(velocity, e), { x: 0, y: 3 }, "extra component zero-fills");
  assert(a.components.entityHas(flying, e), "extra tag");
  assertEquals(observe(a), observe(b), "override instantiate matches createWith");

  // Overrides are per call: the next instance gets plain prefab defaults.
  const plain = a.entities.instantiateOrThrow(goblin);
  assertEquals(a.components.getEntityData(position, plain), { x: 1.5, y: -2 }, "no stale override");
  assert(!a.components.entityHas(velocity, plain) && !a.components.entityHas(flying, plain), "no stale extras");
});

Deno.test("instantiate overrides are canonicalized like any public write", async () => {
  const world = await createTestWorld(allComponents);
  const e = world.entities.instantiateOrThrow(goblin, [[stats, { level: 257, speed: 0.1 }]]);
  assertEquals(world.components.getEntityData(stats, e), { level: 1, speed: Math.fround(0.1) }, "canonical");
});

Deno.test("instantiate is atomic: rejected calls allocate nothing and publish nothing", async () => {
  const [a, b] = await twinWorlds(8);
  churn(a);
  churn(b);
  const before = observe(a);
  assertThrows(() => a.entities.instantiate(goblin, [[position, { z: 1 }]] as never), ComponentDataError, "z");
  assertThrows(() => a.entities.instantiate(goblin, [[position, { x: Number.NaN }]]), ComponentDataError, "finite");
  assertThrows(() => a.entities.instantiate(goblin, [[enemy], [enemy]]), RangeError, "Duplicate");
  assertThrows(() => a.entities.instantiate(goblin, [[enemy, {}]] as never), ComponentDataError, "no data");
  assertThrows(() => a.entities.instantiate(goblin, [position] as never), TypeError, "tuple");
  const unregistered = new Prefab({ components: [[vec2Component("ghost")]] });
  assertThrows(() => a.entities.instantiate(unregistered), NotRegisteredError, "ghost");
  const ghostOverride = [[vec2Component("ghost2")]] as const;
  assertThrows(() => a.entities.instantiate(goblin, ghostOverride), NotRegisteredError, "ghost2");

  const lonely = new Prefab({ components: [[leader]] });
  a.entities.instantiateOrThrow(lonely);
  b.entities.createWithOrThrow([[leader]]);
  const afterLeader = observe(a);
  assertThrows(() => a.entities.instantiate(lonely), RangeError, "leader");
  assertThrows(() => a.entities.instantiate(goblin, [[leader]]), RangeError, "leader");
  assertEquals(observe(a), afterLeader, "capped rejection left no trace");
  assert(JSON.stringify(before) !== JSON.stringify(afterLeader), "sanity: the leader instance is observable");
  assertEquals(observe(a), observe(b), "rejections are invisible");
  assertStrictEquals(peekNextHandle(a), peekNextHandle(b), "rejections consumed no generation");
});

Deno.test("instantiate returns undefined at capacity and instantiateOrThrow throws", async () => {
  const world = await createTestWorld(allComponents, 8);
  for (let i = 0; i < 8; i++) world.entities.instantiateOrThrow(goblin);
  const before = observe(world);
  assertStrictEquals(world.entities.instantiate(goblin), undefined, "soft failure");
  assertThrows(() => world.entities.instantiateOrThrow(goblin), CapacityError, "capacity");
  assertEquals(observe(world), before, "full world unchanged");
});

Deno.test("instantiate requires an initialized world", () => {
  const world = new World({ capacity: 8, components: allComponents });
  assertThrows(() => world.entities.instantiate(goblin), WorldStateError, "");
  assertThrows(() => world.entities.instantiateMany(goblin, 2), WorldStateError, "");
});

Deno.test("instantiate supports capped (sparse) components and defaults", async () => {
  const world = await createTestWorld(allComponents);
  const bigBoss = new Prefab({ extends: goblin, components: [[boss, { level: 9, speed: 2.5 }]] });
  const first = world.entities.instantiateOrThrow(bigBoss);
  const second = world.entities.instantiateOrThrow(bigBoss, [[boss, { speed: 1 }]]);
  assertEquals(world.components.getEntityData(boss, first), { level: 9, speed: 2.5 }, "sparse defaults");
  assertEquals(world.components.getEntityData(boss, second), { level: 9, speed: 1 }, "sparse override merge");
  assertThrows(() => world.entities.instantiate(bigBoss), RangeError, "bossStats");
  world.entities.destroy(first);
  const third = world.entities.instantiateOrThrow(bigBoss);
  assertEquals(world.components.getEntityData(boss, third), { level: 9, speed: 2.5 }, "freed sparse row reused");
});

Deno.test("prefabs are world-independent and never occupy slots", async () => {
  const reordered = await createTestWorld([enemy, stats, health, position, velocity, flying, leader, boss], 16);
  const original = await createTestWorld(allComponents, 16);
  assertStrictEquals(original.entities.getActiveCount(), 0, "defining prefabs allocates nothing");
  const e1 = reordered.entities.instantiateOrThrow(goblin);
  const e2 = original.entities.instantiateOrThrow(goblin);
  assertEquals(reordered.components.getEntityData(stats, e1), { level: 3, speed: 0 }, "reordered registration");
  assertEquals(original.components.getEntityData(stats, e2), { level: 3, speed: 0 }, "original registration");
  assertStrictEquals(reordered.entities.getActiveCount(), 1, "only the instance is active");
  assertEquals(reordered.entities.querySnapshot(new Query({ none: [flying] })), [e1], "none-only query sees instance");
});

// --- Bulk instantiate ---

Deno.test("instantiateMany matches N createWith calls and returns a borrowed list", async () => {
  const [a, b] = await twinWorlds();
  churn(a);
  churn(b);
  const list = a.entities.instantiateMany(goblin, 10, [[velocity, { x: 4 }]])!;
  const expected: Entity[] = [];
  const twinBundle = [...goblinBundle, [velocity, { x: 4 }]] as const;
  for (let i = 0; i < 10; i++) {
    expected.push(b.entities.createWithOrThrow(twinBundle));
  }
  assertStrictEquals(list.count, 10, "count");
  const handles: Entity[] = [];
  list.each((slot, entity, i) => {
    assertStrictEquals(slot, entityIndex(entity), `slot ${i}`);
    assertStrictEquals(list.slots[i], slot, `slots[${i}]`);
    handles.push(entity);
  });
  assertEquals(handles, expected, "handles in allocation order");
  assertEquals([...list], expected, "iterable");
  assertEquals(a.entities.toArray(list), expected, "toArray");
  assertEquals(observe(a), observe(b), "bulk instantiate matches repeated createWith");
  a.refresh();
  b.refresh();
  assertEquals(observe(a), observe(b), "after refresh");
  assertStrictEquals(peekNextHandle(a), peekNextHandle(b), "next allocation");
});

Deno.test("instantiateMany list supports per-instance tweaks through slots", async () => {
  const world = await createTestWorld(allComponents);
  const list = world.entities.instantiateMany(goblin, 4)!;
  const x = world.components.require(position).storage.partitions.x;
  for (let i = 0; i < list.count; i++) x[list.slots[i]!] = i * 10;
  const values = world.entities.toArray(list).map((e) => world.components.getEntityData(position, e).x);
  assertEquals(values, [0, 10, 20, 30], "per-instance writes");
});

Deno.test("instantiateMany is all-or-nothing", async () => {
  const [a, b] = await twinWorlds(8);
  churn(a);
  churn(b);
  const before = observe(a);
  assertStrictEquals(a.entities.instantiateMany(goblin, 8), undefined, "not enough room for 8");
  assertThrows(() => a.entities.instantiateManyOrThrow(goblin, 8), CapacityError, "capacity");
  const twoBosses = new Prefab({ components: [[boss, { level: 1 }]] });
  assertThrows(() => a.entities.instantiateMany(twoBosses, 3), RangeError, "bossStats");
  assertThrows(() => a.entities.instantiateMany(goblin, 3, [[leader]]), RangeError, "leader");
  assertThrows(() => a.entities.instantiateMany(goblin, 2, [[position, { q: 1 }]] as never), ComponentDataError, "q");
  assertThrows(() => a.entities.instantiateMany(goblin, -1), RangeError, "count");
  assertThrows(() => a.entities.instantiateMany(goblin, 1.5), RangeError, "count");
  assertEquals(observe(a), before, "rejected bulk calls left no trace");
  assertStrictEquals(peekNextHandle(a), peekNextHandle(b), "no generation consumed");

  const empty = a.entities.instantiateMany(goblin, 0)!;
  assertStrictEquals(empty.count, 0, "zero count is an empty list");
  const exact = a.entities.instantiateManyOrThrow(goblin, 7);
  assertStrictEquals(exact.count, 7, "fills remaining capacity exactly");
  assertStrictEquals(a.entities.getAvailableCount(), 0, "world full");
});

// --- Rollback ---

Deno.test("instantiate inside a rollback scope is undone; instantiate after restore still works", async () => {
  const [a, b] = await twinWorlds();
  churn(a);
  churn(b);
  a.refresh();
  b.refresh();
  const untouched = observe(a, false);
  // A prefab whose archetype is first created inside the scope, so restore drops that archetype.
  const scoutBundle = [[velocity, { x: 1 }], [flying], [stats, { speed: 3 }]] as const;
  const scout = new Prefab({ components: scoutBundle });

  const pointA = captureWorldRollbackPoint(a);
  a.entities.instantiateOrThrow(scout);
  a.entities.instantiateMany(goblin, 5);
  restoreWorldRollbackPoint(a, pointA);
  // The twin speculates the same way through createWith, so retired generations match too.
  const pointB = captureWorldRollbackPoint(b);
  b.entities.createWithOrThrow(scoutBundle);
  for (let i = 0; i < 5; i++) b.entities.createWithOrThrow(goblinBundle);
  restoreWorldRollbackPoint(b, pointB);

  assertEquals(observe(a, false), untouched, "restore removes every speculative instance");
  assertEquals(observe(a, false), observe(b, false), "restore is neutral");
  const viaPrefab = a.entities.instantiateOrThrow(scout);
  const viaBundle = b.entities.createWithOrThrow(scoutBundle);
  assertStrictEquals(viaPrefab, viaBundle, "same handle after restore");
  const manyA = a.entities.toArray(a.entities.instantiateManyOrThrow(goblin, 3));
  const manyB = [0, 1, 2].map(() => b.entities.createWithOrThrow(goblinBundle));
  assertEquals(manyA, manyB, "bulk handles after restore");
  assertEquals(observe(a, false), observe(b, false), "instantiate after restore matches createWith");
});

// --- Typed named-map world ---

Deno.test("EcsWorld.prefab and instantiate use named specs", async () => {
  const game = createEcsWorld({
    capacity: 32,
    components: { Position: { x: Float32Array, y: Float32Array }, Health: { hp: Uint16Array } },
    tags: { Enemy: true, Flying: true },
  });
  await game.init();
  const orc = game.prefab({ Position: { x: 1 }, Health: { hp: 20 }, Enemy: true }, { name: "orc" });
  const bat = game.prefab({ Flying: true, Health: { hp: 2 } }, { extends: orc });
  assertStrictEquals(orc.name, "orc", "name");
  assertEquals(bat.components.map((c) => c.name), ["Position", "Health", "Enemy", "Flying"], "extends");

  const e = game.instantiate(orc, { Position: { y: 5 } });
  assertEquals(game.world.components.getEntityData("Position", e), { x: 1, y: 5 }, "named override merges");
  const flyer = game.instantiate(bat);
  assertEquals(game.world.components.getEntityData("Health", flyer), { hp: 2 }, "child default");
  assert(game.world.components.entityHas("Enemy", flyer), "inherited tag");

  const list = game.instantiateMany(orc, 3, { Flying: true });
  assertStrictEquals(list.count, 3, "bulk");
  assert(game.world.components.entityHas("Flying", list.entities[2]!), "bulk override tag");

  assertThrows(() => game.prefab({ Unknown: true } as never), Error, "Unknown component");
  assertThrows(() => game.prefab({ Enemy: false } as never), TypeError, "must be spawned with true");
  assertThrows(() => game.instantiate(orc, { Nope: { x: 1 } } as never), Error, "Unknown component");
  const plain = game.instantiate(orc);
  assertEquals(game.world.components.getEntityData("Position", plain), { x: 1, y: 0 }, "no stale override");
});

Deno.test("instantiate called from an override getter does not clobber the outer call", async () => {
  const world = await createTestWorld(allComponents);
  let inner: Entity | undefined;
  const data = {
    get x(): number {
      inner ??= world.entities.instantiateOrThrow(goblin, [[velocity, { x: 8 }]]);
      return 3;
    },
  };
  const outer = world.entities.instantiateOrThrow(goblin, [[position, data as { x: number }]]);
  assert(inner !== undefined, "inner ran");
  assertEquals(world.components.getEntityData(position, outer), { x: 3, y: -2 }, "outer override");
  assert(!world.components.entityHas(velocity, outer), "inner extras did not leak into outer");
  assertEquals(world.components.getEntityData(velocity, inner), { x: 8, y: 0 }, "inner override");
  assertEquals(world.components.getEntityData(position, inner), { x: 1.5, y: -2 }, "inner defaults");
});

// Keep the bundle type exercised so the prefab and createWith inputs stay structurally identical.
const _bundleShape: readonly ComponentBundleEntryInput[] = goblinBundle;
void _bundleShape;
