/// <reference lib="deno.ns" />

import {
  type DynamicComponent,
  type Entity,
  entityIndex,
  NotRegisteredError,
  Query,
  type SlotIndex,
  System,
  type World,
  WorldRollbackScope,
} from "../mod.ts";
import { ArchetypeManager } from "../src/archetype/archetype-manager.ts";
import { ComponentManager } from "../src/component/component-manager.ts";
import { EntityManager } from "../src/entity/entity-manager.ts";
import { QueryManager } from "../src/query/query-manager.ts";
import { QueryEntityResult } from "../src/query/query-result.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids, listIds } from "./helpers.ts";

function sorted(iterable: Iterable<number>): number[] {
  return [...iterable].toSorted((a, b) => a - b);
}

/** Model oracle: active entities whose components satisfy the query's all / any / none terms, sorted. */
function expectedMembers(world: World, query: Query): number[] {
  const has = (component: DynamicComponent, entity: Entity) => world.components.entityHas(component, entity);
  const members: number[] = [];
  for (const entity of world.entities.getActiveSnapshot()) {
    if (!query.all.every((component) => has(component, entity))) continue;
    if (query.none.some((component) => has(component, entity))) continue;
    if (query.any.length > 0 && !query.any.some((component) => has(component, entity))) continue;
    members.push(entity);
  }
  return sorted(members);
}

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const position = vec2Component("position");
const tags = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((name) => tagComponent(name));
const components: DynamicComponent[] = [position, ...tags];
const queries = [
  new Query({ all: [position] }),
  new Query({ all: [tags[0]!] }),
  new Query({ any: [tags[1]!, tags[2]!], none: [tags[3]!] }),
  new Query({ none: [tags[4]!] }),
  new Query({ all: [tags[5]!, tags[6]!] }),
];

/** Every query view, unsorted, so any change in iteration order changes the trace. */
function record(world: World, trace: string[], label: string): void {
  for (let q = 0; q < queries.length; q++) {
    const query = queries[q]!;
    const list = world.entities.queryList(query);
    const listed: number[] = [];
    for (let i = 0; i < list.count; i++) listed.push(list.entities[i]!, list.slots[i]!);
    trace.push(
      `${label}#${q} list=${listed.join(",")}` +
        ` entered=${[...world.entities.queryEntered(query)].join(",")}` +
        ` exited=${[...world.entities.queryExited(query)].join(",")}`,
    );
  }
}

function step(world: World, live: Entity[], random: Rng): void {
  const op = random() % 9;
  if (op <= 1 || live.length === 0) {
    const entity = world.entities.create();
    if (entity !== undefined) live.push(entity);
    return;
  }
  const index = random() % live.length;
  const entity = live[index]!;
  if (op === 2) {
    world.entities.destroy(entity);
    live.splice(index, 1);
    return;
  }
  const component = components[random() % components.length]!;
  if (op === 3) {
    world.components.removeFromEntity(component, entity);
    return;
  }
  if (op === 4) {
    // Batch move over every source archetype the query spans.
    const list = world.entities.queryList(queries[random() % queries.length]!);
    if (component === position) world.components.addToEntities(position, list, { x: 1, y: 2 });
    else world.components.addToEntities(component as (typeof tags)[number], list);
    return;
  }
  if (op === 5) {
    world.components.removeFromEntities(component, world.entities.queryList(queries[random() % queries.length]!));
    return;
  }
  if (component === position) world.components.addToEntity(position, entity, { x: index, y: 1 });
  else world.components.addToEntity(component as (typeof tags)[number], entity);
}

async function orderTrace(): Promise<string[]> {
  const world = await createTestWorld(components, 96);
  const random = rng(0x5eed);
  const live: Entity[] = [];
  const trace: string[] = [];
  for (let i = 0; i < 48; i++) {
    const entity = world.entities.create()!;
    live.push(entity);
    const mask = random();
    if (mask & 1) world.components.addToEntity(position, entity, { x: i, y: 0 });
    for (let t = 0; t < tags.length; t++) if (mask & (2 << t)) world.components.addToEntity(tags[t]!, entity);
  }
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 20; i++) step(world, live, random);
    record(world, trace, `r${round}`);
    if (round % 6 === 5) {
      const point = new WorldRollbackScope(world);
      const speculative = [...live];
      for (let i = 0; i < 15; i++) step(world, speculative, random);
      record(world, trace, `r${round}-speculative`);
      if (round % 12 === 5) {
        point.restore();
        record(world, trace, `r${round}-restored`);
      } else {
        point.commit();
        live.length = 0;
        live.push(...speculative);
      }
    }
    if (round % 3 !== 2) world.refresh();
  }
  await world.destroy();
  return trace;
}

Deno.test("query views keep their exact iteration order through moves, batches and rollback", async () => {
  const trace = await orderTrace();
  assertEquals(trace.length, (24 + 4 + 2) * queries.length, "Trace length");
  // Golden re-recorded when entity slots moved from LIFO to next-fit reuse (handles changed, view logic did not),
  // and again when the live archetype view (`queryEntities`) was removed from the trace.
  assertEquals(fnv1a(trace.join("\n")), "3e39b65d", "Query view order diverged from the recorded golden trace");
});

/** Every listed handle must be the live handle for its slot, and the list must hold exactly the model's members. */
function assertListsCarryLiveHandles(world: World, label: string): void {
  for (let q = 0; q < queries.length; q++) {
    const list = world.entities.queryList(queries[q]!);
    assertEquals(sorted(listIds(list)), expectedMembers(world, queries[q]!), `${label}#${q} members`);
    for (let i = 0; i < list.count; i++) {
      const entity = list.entities[i]!;
      assertStrictEquals(list.slots[i], entityIndex(entity), `${label}#${q}[${i}] slot`);
      assert(world.entities.isActive(entity), `${label}#${q}[${i}] is live`);
    }
  }
}

Deno.test("query results carry each recycled slot's current generation through moves and rollback", async () => {
  // A small capacity forces slot recycling, so stale generations would show up as dead handles.
  const world = await createTestWorld(components, 24);
  const random = rng(0x9e7);
  const live: Entity[] = [];
  for (let round = 0; round < 60; round++) {
    for (let i = 0; i < 12; i++) step(world, live, random);
    assertListsCarryLiveHandles(world, `r${round}`);
    if (round % 5 === 4) {
      const point = new WorldRollbackScope(world);
      const speculative = [...live];
      for (let i = 0; i < 12; i++) step(world, speculative, random);
      assertListsCarryLiveHandles(world, `r${round}-speculative`);
      point.restore();
      assertListsCarryLiveHandles(world, `r${round}-restored`);
    }
    world.refresh();
  }
  await world.destroy();
});

Deno.test("an unrelated structural change keeps other query results without refilling them", async () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const unrelated = tagComponent("unrelated");
  const world = await createTestWorld([a, b, unrelated], 64);
  const withA = new Query({ all: [a] });
  const withB = new Query({ all: [b] });
  for (let i = 0; i < 4; i++) {
    world.components.addToEntity(a, createEntity(world));
    world.components.addToEntity(b, createEntity(world));
  }
  const listA = world.entities.queryList(withA);
  const listB = world.entities.queryList(withB);
  // A sentinel survives only if the retained result is not refilled.
  const entitiesA = listA.entities as unknown as Uint32Array;
  const realA = entitiesA[0]!;
  entitiesA[0] = 0xffff_ffff;

  const churn = createEntity(world);
  world.components.addToEntity(unrelated, churn);
  world.entities.destroy(churn);
  assertStrictEquals(world.entities.queryList(withA).entities[0], 0xffff_ffff as Entity, "Unrelated churn refilled A");

  // A change to a listed archetype refills only that query.
  world.components.addToEntity(b, createEntity(world));
  assertStrictEquals(world.entities.queryList(withA).entities[0], 0xffff_ffff as Entity, "B churn refilled A");
  assertStrictEquals(world.entities.queryList(withB).count, 5, "B sees the new member");
  assertStrictEquals(world.entities.queryList(withB), listB, "B keeps its retained result object");

  // A new archetype joining the query's list refills it.
  const both = createEntity(world);
  world.components.addToEntity(a, both);
  world.components.addToEntity(unrelated, both);
  const refilled = world.entities.queryList(withA);
  assertStrictEquals(refilled.count, 5, "A sees the entity in the new archetype");
  assertStrictEquals(refilled.entities[0], realA as Entity, "A was refilled from its archetypes");
  await world.destroy();
});

Deno.test("a related change refills a query result by copying stored handles, not re-packing slots", async () => {
  const a = tagComponent("a");
  const world = await createTestWorld([a], 4096);
  const withA = new Query({ all: [a] });
  for (let i = 0; i < 2000; i++) world.components.addToEntity(a, createEntity(world));
  world.refresh();
  assertStrictEquals(world.entities.queryList(withA).count, 2000, "Initial fill");

  const spawned = createEntity(world);
  world.components.addToEntity(a, spawned);
  world.entities.destroy(spawned);
  const pack = EntityManager.prototype.packSlot;
  let packed = 0;
  EntityManager.prototype.packSlot = function (this: EntityManager, slot: number): ReturnType<typeof pack> {
    packed++;
    return pack.call(this, slot);
  };
  try {
    const list = world.entities.queryList(withA);
    assertStrictEquals(list.count, 2000, "Refilled after the related change");
  } finally {
    EntityManager.prototype.packSlot = pack;
  }
  assertStrictEquals(packed, 0, "A refill copies each archetype's stored handles");
  await world.destroy();
});

Deno.test("refills stay exact when archetype lists are much larger than their populations", async () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const world = await createTestWorld([a, b], 4096);
  const withA = new Query({ all: [a] });
  const entities: Entity[] = [];
  for (let i = 0; i < 1000; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(a, entity);
    entities.push(entity);
  }
  const check = (label: string) => {
    const list = world.entities.queryList(withA);
    assertEquals(sorted(listIds(list)), expectedMembers(world, withA), `${label}: list holds exactly the members`);
    for (let i = 0; i < list.count; i++) assertStrictEquals(list.slots[i], entityIndex(list.entities[i]!), label);
  };
  check("full");
  // Shrink {a} far below its list length (copy loop path) while {a, b} fills (bulk copy path).
  for (let i = 0; i < 990; i++) world.components.addToEntity(b, entities[i]!);
  check("mostly moved");
  for (let i = 0; i < 990; i += 3) world.entities.destroy(entities[i]!);
  check("after destroys");
  for (let i = 1; i < 990; i += 3) world.components.removeFromEntity(b, entities[i]!);
  check("partly moved back");
  await world.destroy();
});

Deno.test("rollback restore refills every query result", async () => {
  const a = tagComponent("a");
  const world = await createTestWorld([a], 32);
  const withA = new Query({ all: [a] });
  const kept = createEntity(world);
  world.components.addToEntity(a, kept);
  world.refresh();
  assertEquals(listIds(world.entities.queryList(withA)), [kept], "Before speculation");

  const point = new WorldRollbackScope(world);
  world.components.addToEntity(a, createEntity(world));
  world.components.removeFromEntity(a, kept);
  assertStrictEquals(world.entities.queryList(withA).count, 1, "Speculative membership");
  point.restore();
  assertEquals(listIds(world.entities.queryList(withA)), [kept], "Restored membership");
  await world.destroy();
});

Deno.test("query result buffers grow from a small start and stay coherent", async () => {
  const a = tagComponent("a");
  const world = await createTestWorld([a], 4096);
  const withA = new Query({ all: [a] });
  const first = createEntity(world);
  world.components.addToEntity(a, first);
  const small = world.entities.queryList(withA);
  assert((small.entities as unknown as Uint32Array).length < 4096, "Result is not sized by world capacity");

  const expected: Entity[] = [first];
  for (let i = 0; i < 1000; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(a, entity);
    expected.push(entity);
  }
  const grown = world.entities.queryList(withA);
  assertStrictEquals(grown, small, "The retained result object is reused");
  assertStrictEquals(grown.count, 1001, "Count after growth");
  assertEquals(listIds(grown), expected, "Entities after growth");
  assertEquals([...world.entities.query(withA)], expected, "Borrowed iterator follows the grown buffer");
  const slots: number[] = [];
  grown.each((slot, entity) => {
    assertStrictEquals(slot, entityIndex(entity), "Slot matches its entity");
    slots.push(slot);
  });
  assertStrictEquals(slots.length, 1001, "each() walks every entry");

  const direct = new QueryEntityResult(8);
  for (let i = 0; i < 8; i++) direct.add(i as Entity, i as SlotIndex);
  assertStrictEquals(direct.count, 8, "A direct result grows up to its capacity");
  assertEquals([...direct], [0, 1, 2, 3, 4, 5, 6, 7], "Direct result keeps its entries across growth");
  await world.destroy();
});

Deno.test("archetype query iterators are reused without sharing state", async () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const world = await createTestWorld([a, b], 32);
  const withA = new Query({ all: [a] });
  const entities: Entity[] = [];
  for (let i = 0; i < 4; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(a, entity);
    if (i % 2 === 0) world.components.addToEntity(b, entity);
    entities.push(entity);
  }

  const first = world.entities.queryEntered(withA);
  const live = [...first];
  assertEquals(sorted(live), sorted(entities), "Full pass");
  assertStrictEquals(first.next().done, true, "Exhausted iterator stays done until reused");
  const second = world.entities.queryEntered(withA);
  assertStrictEquals(second, first, "An exhausted iterator is reused");
  assertEquals([...second], live, "A reused iterator restarts in the same order");

  // Early exit returns the iterator to the pool.
  let seen = 0;
  for (const _entity of world.entities.queryEntered(withA)) {
    if (++seen === 2) break;
  }
  assertEquals(sorted([...world.entities.queryEntered(withA)]), sorted(entities), "Entered after a break");

  // Iterators opened together are independent.
  const x = world.entities.queryEntered(withA);
  const y = world.entities.queryEntered(withA);
  assert(x !== y, "Concurrent iterators are distinct");
  assertStrictEquals(x.next().value, live[0], "x starts at the first entity");
  assertStrictEquals(y.next().value, live[0], "y starts independently");
  assertStrictEquals(x.next().value, live[1], "x advances on its own");
  x.return?.();
  y.return?.();

  // Like the generators, the query resolves lazily and sees state at first next().
  const lazy = world.entities.queryExited(withA);
  world.refresh();
  world.components.removeFromEntity(a, entities[0]!);
  assertEquals([...lazy], [entities[0]], "Exited reads the window when iteration starts");
  await world.destroy();
});

/** One world's archetype and query state, wired the way `World` wires it. */
function worldParts(
  components: DynamicComponent[],
  capacity: number,
): { componentManager: ComponentManager; archetypes: ArchetypeManager; queries: QueryManager } {
  const componentManager = new ComponentManager(capacity, components);
  const archetypes = new ArchetypeManager(capacity, components.length);
  const queries = new QueryManager(
    {
      getInstances: (list) => componentManager.getInstances(list),
      componentCount: components.length,
      isInitialized: () => true,
    },
    capacity,
    archetypes,
  );
  return { componentManager, archetypes, queries };
}

Deno.test("worlds keep separate structural clocks, so one world's changes keep another's results current", () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const first = worldParts([a, b], 8);
  const second = worldParts([a, b], 8);
  const withA = new Query({ all: [a] });
  const instanceA = first.componentManager.getInstance(a)!;
  const instanceB = second.componentManager.getInstance(b)!;

  first.archetypes.addComponent(0 as Entity, instanceA);
  assertStrictEquals(first.queries.entityList(withA).count, 1, "First world lists its entity");
  const instance = first.queries.register(withA);
  const tick = first.archetypes.clock.tick;
  assertStrictEquals(instance.resultStamp, tick, "A freshly filled result is stamped with its world's tick");

  for (let slot = 0; slot < 8; slot++) second.archetypes.addComponent(slot as Entity, instanceB);
  second.queries.entityList(withA);
  assertStrictEquals(first.archetypes.clock.tick, tick, "Changes in another world leave this world's clock alone");
  assert(second.archetypes.clock.tick > 0, "The other world's clock advanced");
  assertStrictEquals(instance.resultStamp, first.archetypes.clock.tick, "The fast path still applies");
  assertStrictEquals(first.queries.entityList(withA).count, 1, "The retained result is unchanged");
});

Deno.test("archetype manager rejects archetypes it does not hold", () => {
  const capacity = 8;
  const first = new ArchetypeManager(capacity, 2);
  const second = new ArchetypeManager(capacity, 2);
  const entity = 0 as Entity;
  assertThrows(() => first.set(second.root, entity), NotRegisteredError, "Invalid archetype.");
  assertStrictEquals(first.set(first.root, entity), first.root, "Own root is accepted");
});

Deno.test("systems see every match after their query result grows", async () => {
  const a = tagComponent("a");
  const seen: number[][] = [];
  const system = new System({
    name: "collect",
    query: new Query({ all: [a] }),
    callback: (_components, entities) => {
      const run: number[] = [];
      for (let i = 0; i < entities.count; i++) {
        assertStrictEquals(entities.slots[i], entityIndex(entities.entities[i]!), "Slot matches entity");
        run.push(entities.entities[i]!);
      }
      seen.push(run);
    },
  });
  const world = await createTestWorld([a], 1024);
  const update = world.systems.register(system);
  const expected: Entity[] = [createEntity(world)];
  world.components.addToEntity(a, expected[0]!);
  update();
  for (let i = 0; i < 100; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(a, entity);
    expected.push(entity);
  }
  update();
  assertEquals(seen, [[expected[0]!], expected], "The second run sees the grown result");
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

Deno.test("component query cache access does not freshen stale entity query results", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], 8);

  const entity = createEntity(world);
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
