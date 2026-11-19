/// <reference lib="deno.ns" />

import {
  ArgumentError,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  createEcsWorld,
  type DynamicComponent,
  type Entity,
  entityIndex,
  EntityNotFoundError,
  field,
  NotRegisteredError,
  Prefab,
  Query,
  Relation,
  RelationCycleError,
  SpecError,
  World,
  WorldRollbackScope,
} from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids, listIds } from "./helpers.ts";

const position = vec2Component("position");
const hidden = tagComponent("hidden");

function relations() {
  return {
    childOf: new Relation({ name: "childOf", exclusive: true, acyclic: true, onDeleteTarget: "cascade" }),
    likes: new Relation({ name: "likes" }),
    targets: new Relation({ name: "targets", schema: { weight: Float32Array, priority: Uint8Array } }),
  };
}

async function relationWorld(capacity = 64): Promise<{ world: World } & ReturnType<typeof relations>> {
  const defs = relations();
  const world = await createTestWorld([position, hidden, defs.childOf, defs.likes, defs.targets], capacity);
  return { world, ...defs };
}

/** Spawned entities; the first eight are typed as present so tests can destructure them. */
type Spawned = [Entity, Entity, Entity, Entity, Entity, Entity, Entity, Entity, ...Entity[]];

function spawn(world: World, count: number): Spawned {
  const result: Entity[] = [];
  for (let i = 0; i < count; i++) result.push(createEntity(world));
  return result as Spawned;
}

Deno.test("relation spec validation", () => {
  assertThrows(() => new Relation({ name: "" }), SpecError, "Invalid relation");
  assertThrows(() => new Relation({ name: "r", acyclic: true }), SpecError, "acyclic");
  assertThrows(
    () => new Relation({ name: "r", onDeleteTarget: "explode" as "remove" }),
    SpecError,
    "onDeleteTarget",
  );
  assertThrows(() => new Relation({ name: "r", schema: { entity: Float32Array } }), SpecError, "Invalid relation");
  const relation = new Relation({ name: "r", exclusive: true });
  assertStrictEquals(relation.exclusive, true, "exclusive flag is exposed");
  assertStrictEquals(relation.onDeleteTarget, "remove", "auto-remove is the default");
  assertStrictEquals(relation.isTag, true, "the relation's presence component is a tag");
});

Deno.test("unregistered relations are rejected", async () => {
  const { world } = await relationWorld();
  const other = new Relation({ name: "other" });
  const [a, b] = spawn(world, 2);
  assertThrows(() => world.relations.add(other, a!, b!), NotRegisteredError, "other");
  assertThrows(() => world.relations.getSources(other, b!), NotRegisteredError, "other");
});

Deno.test("multi-target relations keep insertion order on both sides", async () => {
  const { world, likes } = await relationWorld();
  const [a, b, c, d] = spawn(world, 4);
  world.relations.add(likes, a!, b!);
  world.relations.add(likes, a!, c!);
  world.relations.add(likes, d!, b!);
  world.relations.add(likes, a!, b!); // duplicate: no-op, no reorder

  assertEquals(listIds(world.relations.getTargets(likes, a!)), [b, c], "targets of a in insertion order");
  assertEquals(listIds(world.relations.getSources(likes, b!)), [a, d], "sources of b in insertion order");
  assertStrictEquals(world.relations.has(likes, a!, c!), true, "a likes c");
  assertStrictEquals(world.relations.hasAny(likes, a!), true, "a likes something");
  assertStrictEquals(world.relations.hasAny(likes, c!), false, "c likes nothing");
  assertStrictEquals(world.relations.getTarget(likes, a!), b, "first target");
  assertStrictEquals(world.relations.getTarget(likes, c!), undefined, "no target");

  assertStrictEquals(world.relations.remove(likes, a!, b!), true, "removed a->b");
  assertStrictEquals(world.relations.remove(likes, a!, b!), false, "already removed");
  assertEquals(listIds(world.relations.getTargets(likes, a!)), [c], "remaining target");
  assertEquals(listIds(world.relations.getSources(likes, b!)), [d], "remaining source keeps order");
  assertEquals(listIds(world.relations.getAllTargets(likes)), [b, c], "targets with sources in first-targeted order");

  world.relations.add(likes, a!, d!);
  assertStrictEquals(world.relations.removeAll(likes, a!), 2, "removeAll returns the removed pair count");
  assertStrictEquals(world.relations.hasAny(likes, a!), false, "a has no targets");
  assertEquals(listIds(world.relations.getAllTargets(likes)), [b], "c and d are no longer targets");
});

Deno.test("borrowed relation lists expose storage slots and data rows", async () => {
  const { world, likes, targets } = await relationWorld();
  const [a, b, c] = spawn(world, 3);
  world.relations.add(likes, a!, b!);
  world.relations.add(likes, c!, b!);
  const sources = world.relations.getSources(likes, b!);
  assertStrictEquals(sources.count, 2, "two sources");
  assertStrictEquals(sources.slots[0], entityIndex(a!), "slot of the first source");
  assertEquals(ids(sources), [a, c], "iterable over packed handles");
  const seen: number[] = [];
  sources.each((slot, entity, i) => seen.push(slot, entity, i));
  assertEquals(seen, [entityIndex(a!), a, 0, entityIndex(c!), c, 1], "each walks slot, entity, index");

  world.relations.add(targets, a!, b!, { weight: 1.5, priority: 3 });
  world.relations.add(targets, a!, c!, { weight: 2.5 });
  const pairs = world.relations.getTargets(targets, a!);
  const instance = world.relations.getInstanceOrThrow(targets);
  const weight = instance.partitions.weight;
  assertEquals([weight[pairs.rows[0]!], weight[pairs.rows[1]!]], [1.5, 2.5], "rows index the data columns");
  assertStrictEquals(instance.rowOf(a!, c!), pairs.rows[1], "rowOf resolves the pair row");
  assertStrictEquals(instance.rowOf(b!, c!), -1, "rowOf is -1 for a missing pair");
  assertStrictEquals(world.relations.getInstance(targets), instance, "getInstance returns the cached view");
  assertStrictEquals(world.relations.getInstanceOrThrow(targets), instance, "both forms share one view");
  world.relations.add(targets, b!, c!);
  world.relations.add(targets, c!, a!);
  assertStrictEquals(instance.partitions.weight, world.relations.getInstance(targets)!.partitions.weight, "view stays");
  const stranger = new Relation({ name: "stranger" });
  assertStrictEquals(world.relations.getInstance(stranger), undefined, "unregistered relation reads undefined");
  assertThrows(() => world.relations.getInstanceOrThrow(stranger), NotRegisteredError, "stranger");
});

Deno.test("exclusive relations replace their target and report the change", async () => {
  const { world, childOf } = await relationWorld();
  const [parentA, parentB, child] = spawn(world, 3);
  const query = new Query({ all: [childOf] });
  world.relations.add(childOf, child!, parentA!);
  assertEquals(ids(world.entities.queryEntered(query)), [child], "child entered the wildcard query");
  assertEquals(ids(world.relations.getChanged(childOf)), [child], "first target is a change");
  world.refresh();
  assertEquals(ids(world.relations.getChanged(childOf)), [], "refresh clears the changed window");

  world.relations.add(childOf, child!, parentB!);
  assertStrictEquals(world.relations.getTarget(childOf, child!), parentB, "target replaced");
  assertEquals(listIds(world.relations.getTargets(childOf, child!)), [parentB], "exactly one target");
  assertEquals(listIds(world.relations.getSources(childOf, parentA!)), [], "old parent lost its child");
  assertEquals(listIds(world.relations.getSources(childOf, parentB!)), [child], "new parent gained it");
  assertEquals(ids(world.entities.queryEntered(query)), [], "a retarget is not an archetype move");
  assertEquals(ids(world.entities.queryExited(query)), [], "nor an exit");
  assertEquals(ids(world.relations.getChanged(childOf)), [child], "a retarget is reported as changed");
});

Deno.test("relation presence drives wildcard queries and entered/exited windows", async () => {
  const { world, likes } = await relationWorld();
  const [a, b, c] = spawn(world, 3);
  world.components.addToEntity(position, a!, { x: 0, y: 0 });
  world.refresh();
  const liking = new Query({ all: [position, likes] });
  const notLiking = new Query({ all: [position], none: [likes] });
  assertEquals(listIds(world.entities.queryList(notLiking)), [a], "a likes nothing yet");

  world.relations.add(likes, a!, b!);
  world.relations.add(likes, a!, c!);
  assertEquals(listIds(world.entities.queryList(liking)), [a], "a matches the wildcard");
  assertEquals(ids(world.entities.queryEntered(liking)), [a], "entered once");
  assertStrictEquals(world.components.entityHas(likes, a!), true, "entityHas reports the presence tag");
  world.refresh();

  world.relations.remove(likes, a!, b!);
  assertEquals(ids(world.entities.queryExited(liking)), [], "still has a target");
  world.relations.remove(likes, a!, c!);
  assertEquals(ids(world.entities.queryExited(liking)), [a], "last target removed: exited");
  assertEquals(ids(world.entities.queryEntered(notLiking)), [a], "and entered the none query");
  assertEquals(ids(world.relations.getChanged(likes)), [], "a source without targets is not listed as changed");
});

Deno.test("relation data: add, read, write, changed", async () => {
  const { world, targets } = await relationWorld();
  const [a, b, c] = spawn(world, 3);
  world.relations.add(targets, a!, b!, { weight: 0.5, priority: 7 });
  world.relations.add(targets, a!, c!);
  assertEquals(world.relations.getData(targets, a!, b!), { weight: 0.5, priority: 7 }, "payload stored");
  assertEquals(world.relations.getData(targets, a!, c!), { weight: 0, priority: 0 }, "new pairs start at zero");
  assertStrictEquals(world.relations.getData(targets, b!, c!), undefined, "missing pair has no data");
  world.refresh();

  world.relations.setData(targets, a!, c!, { priority: 2 });
  const out = { weight: -1, priority: -1 };
  assertStrictEquals(world.relations.readDataInto(targets, a!, c!, out), true, "pair exists");
  assertEquals(out, { weight: 0, priority: 2 }, "partial writes keep other fields");
  assertEquals(ids(world.relations.getChanged(targets)), [a], "data writes mark the source changed");
  assertThrows(
    () => world.relations.setData(targets, b!, c!, { weight: 1 }),
    ComponentOwnershipError,
    'No "targets" pair',
  );
  assertThrows(
    () => world.relations.add(targets, a!, b!, { weight: Number.NaN }),
    ComponentDataError,
    "finite",
  );
  // Upsert keeps the pair and updates its data.
  world.relations.add(targets, a!, b!, { weight: 4 });
  assertEquals(world.relations.getData(targets, a!, b!), { weight: 4, priority: 7 }, "upsert merges data");
  assertEquals(listIds(world.relations.getTargets(targets, a!)), [b, c], "upsert does not reorder");
});

Deno.test("relation pair storage grows beyond its initial size", async () => {
  const { world, targets } = await relationWorld(256);
  const source = createEntity(world);
  const others = spawn(world, 200);
  for (let i = 0; i < others.length; i++) world.relations.add(targets, source, others[i]!, { weight: i });
  const list = world.relations.getTargets(targets, source);
  assertStrictEquals(list.count, 200, "all pairs stored");
  const weight = world.relations.getInstanceOrThrow(targets).partitions.weight;
  for (let i = 0; i < list.count; i++) {
    assertStrictEquals(list.entities[i], others[i], `target ${i} in order`);
    assertStrictEquals(weight[list.rows[i]!], i, `data ${i} survives growth`);
  }
});

Deno.test("relations respect generational handles", async () => {
  const { world, likes } = await relationWorld(8);
  const [a, b] = spawn(world, 2);
  world.entities.destroy(b!);
  assertThrows(() => world.relations.add(likes, a!, b!), EntityNotFoundError, "not active");
  assertThrows(() => world.relations.add(likes, b!, a!), EntityNotFoundError, "not active");
  assertStrictEquals(world.relations.has(likes, a!, b!), false, "stale target is never related");
  assertStrictEquals(world.relations.getSources(likes, b!).count, 0, "stale target has no sources");
  assertStrictEquals(world.relations.getTargets(likes, b!).count, 0, "stale source has no targets");

  const c = createEntity(world);
  world.relations.add(likes, a!, c);
  world.entities.destroy(c);
  // Churn until c's slot is reused by a new handle.
  let reused: Entity | undefined;
  for (let i = 0; i < 64 && reused === undefined; i++) {
    const e = createEntity(world);
    if (entityIndex(e) === entityIndex(c)) reused = e;
    else world.entities.destroy(e);
  }
  assert(reused !== undefined, "slot reused");
  assertStrictEquals(world.relations.has(likes, a!, reused!), false, "a reused slot does not inherit pairs");
  assertStrictEquals(world.relations.getSources(likes, reused!).count, 0, "no sources on the new handle");
});

Deno.test("destroying a target auto-removes pairs and the presence tag", async () => {
  const { world, likes } = await relationWorld();
  const [a, b, c] = spawn(world, 3);
  world.relations.add(likes, a!, b!);
  world.relations.add(likes, c!, b!);
  world.relations.add(likes, c!, a!);
  world.refresh();
  const liking = new Query({ all: [likes] });

  world.entities.destroy(b!);
  assertStrictEquals(world.entities.isActive(a!), true, "auto-remove keeps sources alive");
  assertStrictEquals(world.relations.hasAny(likes, a!), false, "a lost its only target");
  assertEquals(listIds(world.relations.getTargets(likes, c!)), [a], "c keeps its other target");
  assertEquals(ids(world.entities.queryExited(liking)), [a], "a exited the wildcard query");
  assertEquals(listIds(world.relations.getAllTargets(likes)), [a], "b is no longer a target");

  // Destroying a source unlinks it from its targets.
  world.entities.destroy(c!);
  assertStrictEquals(world.relations.getSources(likes, a!).count, 0, "a has no sources left");
  assertEquals(listIds(world.relations.getAllTargets(likes)), [], "no targets remain");
});

Deno.test("cascade relations destroy sources with their target", async () => {
  const { world, childOf, likes } = await relationWorld();
  const [root, a, b, a1, a2, outsider] = spawn(world, 6);
  world.relations.add(childOf, a!, root!);
  world.relations.add(childOf, b!, root!);
  world.relations.add(childOf, a1!, a!);
  world.relations.add(childOf, a2!, a!);
  world.relations.add(likes, outsider!, a1!);
  world.refresh();

  world.entities.destroy(a!);
  assertEquals(
    [a, a1, a2].map((e) => world.entities.isActive(e!)),
    [false, false, false],
    "subtree destroyed",
  );
  assertStrictEquals(world.entities.isActive(b!), true, "sibling survives");
  assertEquals(listIds(world.relations.getSources(childOf, root!)), [b], "root keeps the surviving child");
  assertStrictEquals(world.relations.hasAny(likes, outsider!), false, "non-cascade pairs into the subtree are removed");
  assertStrictEquals(world.entities.isActive(outsider!), true, "outsider survives");
  assertStrictEquals(world.entities.getActiveCount(), 3, "root, b and outsider remain");
});

Deno.test("cascade handles chains as deep as capacity and cycles", async () => {
  const capacity = 4096;
  const chainRelation = new Relation({ name: "chain", exclusive: true, onDeleteTarget: "cascade" });
  const world = await createTestWorld([chainRelation], capacity);
  const chain = spawn(world, capacity);
  for (let i = 1; i < chain.length; i++) world.relations.add(chainRelation, chain[i]!, chain[i - 1]!);
  world.entities.destroy(chain[0]!);
  assertStrictEquals(world.entities.getActiveCount(), 0, "the whole chain cascaded without recursion");

  // A non-acyclic cascade relation may form a cycle; destroy still terminates.
  const [x, y, z] = spawn(world, 3);
  world.relations.add(chainRelation, x!, y!);
  world.relations.add(chainRelation, y!, z!);
  world.relations.add(chainRelation, z!, x!);
  world.entities.destroy(y!);
  assertStrictEquals(world.entities.getActiveCount(), 0, "the cycle cascaded once");
});

Deno.test("acyclic relations reject self-pairs and cycles", async () => {
  const { world, childOf } = await relationWorld();
  const [a, b, c] = spawn(world, 3);
  world.relations.add(childOf, b!, a!);
  world.relations.add(childOf, c!, b!);
  assertThrows(() => world.relations.add(childOf, a!, a!), RelationCycleError, "cycle");
  assertThrows(() => world.relations.add(childOf, a!, c!), RelationCycleError, "cycle");
  assertStrictEquals(world.relations.hasAny(childOf, a!), false, "rejected add left no pair");
  // Moving a node elsewhere in its own branch is still allowed.
  world.relations.add(childOf, c!, a!);
  assertStrictEquals(world.relations.getTarget(childOf, c!), a, "reparented");
});

Deno.test("generic component APIs refuse relation presence components", async () => {
  const { world, likes } = await relationWorld();
  const [a, b] = spawn(world, 2);
  world.relations.add(likes, a!, b!);
  assertThrows(() => world.components.addToEntity(likes, b!), ArgumentError, "world.relations");
  assertThrows(() => world.components.removeFromEntity(likes, a!), ArgumentError, "world.relations");
  assertThrows(() => world.components.addBundle(b!, [[likes]]), ArgumentError, "world.relations");
  assertThrows(() => world.entities.create([[position, { x: 1, y: 1 }], [likes]]), ArgumentError, "world.relations");
  const list = world.entities.queryList(new Query({ all: [likes] }));
  assertThrows(() => world.components.removeFromEntities(likes, list), ArgumentError, "world.relations");
  assertThrows(() => world.components.addToEntities(likes, list), ArgumentError, "world.relations");
  assertStrictEquals(world.entities.getActiveCount(), 2, "the rejected create(bundle) allocated nothing");
  assertEquals(listIds(world.relations.getTargets(likes, a!)), [b], "relation state untouched");
});

Deno.test("queryList filters a target's sources by a query", async () => {
  const { world, likes } = await relationWorld();
  const [target, a, b, c] = spawn(world, 4);
  world.components.addToEntity(position, a!, { x: 0, y: 0 });
  world.components.addToEntity(position, c!, { x: 0, y: 0 });
  world.components.addToEntity(hidden, c!);
  for (const source of [c, b, a]) world.relations.add(likes, source!, target!);
  const visible = new Query({ all: [position], none: [hidden] });
  assertEquals(listIds(world.relations.queryList(likes, target!, visible)), [a], "only visible positioned sources");
  const all = new Query({ all: [likes] });
  assertEquals(listIds(world.relations.queryList(likes, target!, all)), [c, b, a], "source order is kept");
  world.entities.destroy(target!);
  assertStrictEquals(world.relations.queryList(likes, target!, all).count, 0, "stale target yields nothing");
});

Deno.test("hierarchy traversal is parents-first with depth", async () => {
  const { world, childOf } = await relationWorld();
  const [r1, a, b, c, r2, d, loner] = spawn(world, 7);
  world.relations.add(childOf, a!, r1!);
  world.relations.add(childOf, b!, r1!);
  world.relations.add(childOf, c!, a!);
  world.relations.add(childOf, d!, r2!);

  const forest = world.relations.traverse(childOf);
  const depths = Array.from({ length: forest.count }, (_, i) => forest.depths[i]);
  assertEquals(
    listIds(forest),
    [r1, a, b, c, r2, d],
    "each tree breadth-first, trees in first-targeted order",
  );
  assertEquals(depths, [0, 1, 1, 2, 0, 1], "depths");
  assert(!listIds(forest).includes(loner!), "unrelated entities are not part of the forest");
  assertStrictEquals(forest.slots[3], entityIndex(c!), "slots are parallel to entities");

  const subtree = world.relations.traverse(childOf, a!);
  assertEquals(listIds(subtree), [a, c], "subtree from a root");
  assertEquals([subtree.depths[0], subtree.depths[1]], [0, 1], "subtree depths start at zero");
  assertEquals(listIds(world.relations.traverse(childOf, loner!)), [loner], "a leaf root yields itself");

  // Reparenting is reflected on the next traversal.
  world.relations.add(childOf, r2!, c!);
  assertEquals(listIds(world.relations.traverse(childOf)), [r1, a, b, c, r2, d], "r2 moved under c");
  const moved = world.relations.traverse(childOf);
  assertEquals(
    Array.from({ length: moved.count }, (_, i) => moved.depths[i]),
    [0, 1, 1, 2, 3, 4],
    "depths follow the move",
  );
  // Hierarchy helpers by name.
  assertStrictEquals(world.relations.getTarget(childOf, c!), a, "parent of c");
  assertEquals(listIds(world.relations.getSources(childOf, r1!)), [a, b], "children of r1");
});

Deno.test("queryRevision bumps when a queried relation changes target", async () => {
  const { world, childOf } = await relationWorld();
  const [p1, p2, child] = spawn(world, 3);
  const query = new Query({ all: [childOf] });
  world.relations.add(childOf, child!, p1!);
  const before = world.queryRevision(query);
  world.relations.add(childOf, child!, p2!);
  assert(world.queryRevision(query) > before, "retarget bumps the revision");
});

Deno.test("relation definitions are reusable across worlds", async () => {
  const defs = relations();
  const w1 = await createTestWorld([defs.likes], 8);
  const w2 = await createTestWorld([defs.likes], 8);
  const [a1, b1] = spawn(w1, 2);
  const [a2, b2] = spawn(w2, 2);
  w1.relations.add(defs.likes, a1!, b1!);
  assertStrictEquals(w2.relations.has(defs.likes, a2!, b2!), false, "worlds do not share pairs");
});

Deno.test("checkpoints capture and restore relation pairs and data", async () => {
  const { world, targets, childOf } = await relationWorld();
  const [a, b, c, p] = spawn(world, 4);
  world.relations.add(targets, a!, b!, { weight: 1 });
  world.relations.add(targets, a!, c!, { weight: 2 });
  world.relations.add(childOf, a!, p!);
  const checkpoint = world.captureCheckpoint([a!], targets, childOf);

  world.relations.remove(targets, a!, b!);
  world.relations.setData(targets, a!, c!, { weight: 9 });
  world.relations.add(targets, a!, p!);
  world.relations.removeAll(childOf, a!);
  world.applyCheckpoint(checkpoint);
  assertEquals(listIds(world.relations.getTargets(targets, a!)), [b, c], "targets and their order restored");
  assertEquals(world.relations.getData(targets, a!, c!)?.weight, 2, "data restored");
  assertStrictEquals(world.relations.getTarget(childOf, a!), p, "exclusive target restored");

  world.entities.destroy(b!);
  world.relations.remove(targets, a!, c!);
  assertThrows(() => world.applyCheckpoint(checkpoint), EntityNotFoundError, "not active");
  assertEquals(listIds(world.relations.getTargets(targets, a!)), [], "failed apply mutated nothing");
});

Deno.test("checkpoints refuse to restore a pair that would now close a cycle", async () => {
  const { world, childOf } = await relationWorld();
  const [a, b] = spawn(world, 2);
  world.relations.add(childOf, a, b);
  const checkpoint = world.captureCheckpoint([a], childOf);
  world.relations.removeAll(childOf, a);
  world.relations.add(childOf, b, a); // b is outside the checkpoint; restoring a -> b would close a cycle
  assertThrows(() => world.applyCheckpoint(checkpoint), RelationCycleError, "cycle");
  assertStrictEquals(world.relations.hasAny(childOf, a), false, "failed apply mutated nothing");
  assertStrictEquals(world.relations.getTarget(childOf, b), a, "the outside pair is untouched");
});

type Observation = Record<string, unknown>;

/**
 * Observable relation state, by storage slot: rollback retires speculative generations, so a control world
 * that never rolled back allocates the same slots with different handles (see rollback_neutrality.test.ts).
 */
function observe(world: World, defs: ReturnType<typeof relations>, live: readonly Entity[]): Observation {
  const slots = (list: readonly number[]): number[] => list.map(entityIndex);
  const pairs: unknown[] = [];
  for (const relation of [defs.childOf, defs.likes, defs.targets]) {
    const perEntity = live.map((e) => ({
      targets: slots(listIds(world.relations.getTargets(relation, e))),
      sources: slots(listIds(world.relations.getSources(relation, e))),
    }));
    pairs.push({
      perEntity,
      all: slots(listIds(world.relations.getAllTargets(relation))),
      changed: slots(ids(world.relations.getChanged(relation))),
      query: slots(listIds(world.entities.queryList(new Query({ all: [relation] })))),
      entered: slots(ids(world.entities.queryEntered(new Query({ all: [relation] })))),
    });
  }
  const data = live.flatMap((s) => live.map((t) => world.relations.getData(defs.targets, s, t)));
  const forest = world.relations.traverse(defs.childOf);
  return {
    pairs,
    data,
    forest: slots(listIds(forest)),
    depths: Array.from({ length: forest.count }, (_, i) => forest.depths[i]),
  };
}

Deno.test("rollback restores relation state exactly and order-neutrally", async () => {
  const defsA = relations();
  const defsB = defsA;
  const speculative = await createTestWorld([position, defsA.childOf, defsA.likes, defsA.targets], 32);
  const control = await createTestWorld([position, defsB.childOf, defsB.likes, defsB.targets], 32);

  const setup = (world: World): Entity[] => {
    const live = spawn(world, 8);
    world.relations.add(defsA.childOf, live[1]!, live[0]!);
    world.relations.add(defsA.childOf, live[2]!, live[0]!);
    world.relations.add(defsA.childOf, live[3]!, live[1]!);
    world.relations.add(defsA.likes, live[4]!, live[0]!);
    world.relations.add(defsA.likes, live[4]!, live[5]!);
    world.relations.add(defsA.likes, live[6]!, live[5]!);
    world.relations.add(defsA.targets, live[7]!, live[6]!, { weight: 1.25, priority: 4 });
    world.refresh();
    world.relations.add(defsA.targets, live[7]!, live[5]!, { weight: 3 });
    world.relations.add(defsA.childOf, live[3]!, live[2]!);
    return live;
  };
  const liveS = setup(speculative);
  const liveC = setup(control);

  const before = observe(speculative, defsA, liveS);
  const point = new WorldRollbackScope(speculative);
  // Speculative work: retargets, removals, cascades, new entities and pairs, data writes.
  world_mutate(speculative, defsA, liveS);
  point.restore();
  assertEquals(observe(speculative, defsA, liveS), before, "observable relation state restored");
  assertEquals(observe(speculative, defsA, liveS), observe(control, defsB, liveC), "matches the control world");

  // Identical follow-up work must produce identical results (allocation and list order neutrality).
  const followUp = (world: World, live: Entity[]): Entity[] => {
    const extra = spawn(world, 3);
    world.relations.add(defsA.likes, extra[0]!, live[5]!);
    world.relations.add(defsA.childOf, extra[1]!, live[3]!);
    world.relations.add(defsA.targets, extra[2]!, live[0]!, { weight: 7 });
    world.relations.add(defsA.likes, live[4]!, extra[2]!);
    world.entities.destroy(live[1]!);
    return [...live.filter((e) => world.entities.isActive(e)), ...extra];
  };
  const afterS = followUp(speculative, liveS);
  const afterC = followUp(control, liveC);
  assertEquals(afterS.map(entityIndex), afterC.map(entityIndex), "same slots allocated");
  assertEquals(observe(speculative, defsA, afterS), observe(control, defsB, afterC), "same relation state");

  // Commit keeps speculative relation work.
  const point2 = new WorldRollbackScope(speculative);
  speculative.relations.add(defsA.likes, afterS[0]!, afterS[1]!);
  point2.commit();
  assertStrictEquals(speculative.relations.has(defsA.likes, afterS[0]!, afterS[1]!), true, "committed pair kept");
});

function world_mutate(world: World, defs: ReturnType<typeof relations>, live: readonly Entity[]): void {
  world.relations.add(defs.childOf, live[3]!, live[1]!);
  world.relations.remove(defs.likes, live[4]!, live[0]!);
  world.relations.add(defs.likes, live[6]!, live[0]!);
  world.relations.setData(defs.targets, live[7]!, live[6]!, { weight: 99 });
  world.entities.destroy(live[1]!); // cascades to live[3]
  const extra = spawn(world, 4);
  world.relations.add(defs.likes, extra[0]!, live[5]!);
  world.relations.add(defs.childOf, extra[1]!, extra[0]!);
  world.relations.add(defs.targets, extra[2]!, live[0]!, { weight: 5 });
  world.entities.destroy(live[5]!);
  world.refresh();
  world.relations.add(defs.likes, live[0]!, extra[3]!);
}

Deno.test("createEcsWorld declares typed relations", async () => {
  const game = createEcsWorld({
    capacity: 32,
    components: { Position: { x: Float32Array, y: Float32Array } },
    relations: {
      ChildOf: { exclusive: true, acyclic: true, onDeleteTarget: "cascade" },
      Targets: { schema: { weight: Float32Array } },
    },
  });
  await game.init();
  const parent = game.spawnOrThrow({ Position: { x: 0, y: 0 } });
  const child = game.spawnOrThrow({ Position: { x: 1, y: 1 } });
  game.world.relations.add(game.relations.ChildOf, child, parent);
  game.world.relations.add(game.relations.Targets, child, parent, { weight: 2 });
  assertStrictEquals(game.world.relations.getTarget(game.relations.ChildOf, child), parent, "typed relation works");
  const weight: number | undefined = game.world.relations.getData(game.relations.Targets, child, parent)?.weight;
  assertStrictEquals(weight, 2, "typed relation data");
  assertEquals(
    listIds(game.world.entities.queryList(new Query({ all: [game.components.Position, game.relations.ChildOf] }))),
    [child],
    "relations are usable in queries",
  );
  game.world.entities.destroy(parent);
  assertStrictEquals(game.world.entities.isActive(child), false, "cascade declared through the config");
});

Deno.test("applying a checkpoint with unchanged pairs keeps source order and marks nothing changed", async () => {
  const likes = new Relation({ name: "likes" });
  const world = await createTestWorld([likes], 16);
  const target = world.entities.createOrThrow();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  world.relations.add(likes, a, target);
  world.relations.add(likes, b, target);
  const checkpoint = world.captureCheckpoint([b, a], likes);
  world.refresh();
  world.applyCheckpoint(checkpoint);
  assertEquals(listIds(world.relations.getSources(likes, target)), [a, b], "Reverse order kept");
  assertEquals([...world.relations.getChanged(likes)], [], "No change recorded");
});

Deno.test("relation pair data treats undefined values as absent", async () => {
  const weighted = new Relation({ name: "weighted", schema: { weight: Float32Array } });
  const world = await createTestWorld([weighted], 16);
  const source = world.entities.createOrThrow();
  const target = world.entities.createOrThrow();
  world.relations.add(weighted, source, target, { weight: undefined });
  assertEquals(world.relations.getData(weighted, source, target), { weight: 0 }, "Absent on add: zero");
  world.relations.setData(weighted, source, target, { weight: 2 });
  world.relations.setData(weighted, source, target, { weight: undefined });
  assertEquals(world.relations.getData(weighted, source, target), { weight: 2 }, "Absent on set: unchanged");
});

/** Relations next to a unit with field-type columns, for the cross-feature tests. */
function fieldRelations() {
  const childOf = new Relation({ name: "childOf", exclusive: true, acyclic: true, onDeleteTarget: "cascade" });
  const likes = new Relation({ name: "likes" });
  const unit = new Component({
    name: "unit",
    schema: { hp: Uint16Array, label: field.string(), target: field.entity(), alive: field.bool() },
  });
  const components: DynamicComponent[] = [childOf, likes, unit];
  return { childOf, likes, unit, components };
}

Deno.test("relations x field types: relation pair data rejects field descriptors", () => {
  assertThrows(() => new Relation({ name: "r", schema: { flag: field.bool() } as never }), SpecError, "numeric");
  assertThrows(() => new Relation({ name: "r", schema: { label: field.string() } as never }), SpecError, "numeric");
});

Deno.test("relations x prefabs: a prefab rejects relation components at definition", () => {
  const { childOf, likes, unit } = fieldRelations();
  assertThrows(() => new Prefab({ components: [[childOf]] }), SpecError, "relation");
  const base = new Prefab({ components: [[unit]] });
  assertThrows(() => new Prefab({ extends: base, components: [[likes]] }), SpecError, "relation");
});

Deno.test("relations x prefabs: instantiate overrides reject relation components and change nothing", async () => {
  const { childOf, likes, unit, components } = fieldRelations();
  const world = await createTestWorld(components);
  const prefab = new Prefab({ components: [[unit, { hp: 3 }]] });
  assertThrows(() => world.entities.instantiate(prefab, [[childOf]]), ArgumentError, "relation");
  assertThrows(() => world.entities.instantiateMany(prefab, 2, [[likes]]), ArgumentError, "relation");
  assertEquals(world.entities.getActiveCount(), 0, "Rejected overrides allocate nothing");
  // Relations are attached after instantiation, through world.relations.
  const parent = world.entities.createOrThrow();
  const child = world.entities.instantiateOrThrow(prefab);
  world.relations.add(childOf, child, parent);
  assertEquals(world.relations.getTarget(childOf, child), parent, "Pairs attach to prefab instances");
});

Deno.test("relations x field types: one rollback restores side columns and relation pairs together", async () => {
  const { childOf, likes, unit, components } = fieldRelations();
  const world = await createTestWorld(components);
  const parent = world.entities.createOrThrow([[unit, { hp: 1, label: "parent" }]]);
  const child = world.entities.createOrThrow([[unit, { hp: 2, label: "child", target: parent, alive: true }]]);
  world.relations.add(childOf, child, parent);
  world.refresh();

  const point = new WorldRollbackScope(world);
  world.components.setEntityData(unit, child, { label: "changed", target: null, alive: false });
  world.relations.remove(childOf, child, parent);
  world.relations.add(likes, parent, child);
  world.entities.destroy(parent);
  point.restore();

  assertEquals(
    world.components.getEntityDataOrThrow(unit, child),
    { hp: 2, target: parent, alive: true, label: "child" },
    "Field values restored, including the entity ref to the revived parent",
  );
  assertEquals(world.relations.getTarget(childOf, child), parent, "Relation pair restored");
  assertEquals(world.relations.getTargets(likes, parent).count, 0, "Speculative pair dropped");
  assertEquals(
    world.components.getEntityDataOrThrow(unit, parent).label,
    "parent",
    "Destroyed entity's side cells restored",
  );
});

Deno.test("relations x field types: an entity field reads null after its target dies in a cascade", async () => {
  const { childOf, unit, components } = fieldRelations();
  const world = await createTestWorld(components);
  const root = world.entities.createOrThrow();
  const leaf = world.entities.createOrThrow();
  world.relations.add(childOf, leaf, root);
  const watcher = world.entities.createOrThrow([[unit, { target: leaf }]]);
  world.entities.destroy(root);
  world.refresh();
  assertEquals(world.entities.isActive(leaf), false, "Cascade destroyed the child");
  assertEquals(
    world.components.getEntityDataOrThrow(unit, watcher).target,
    null,
    "Ref to the cascaded entity reads null",
  );
});

Deno.test("relations x field types: a checkpoint restores field columns and relation pairs together", async () => {
  const { childOf, unit, components } = fieldRelations();
  const world = await createTestWorld(components);
  const parent = world.entities.createOrThrow();
  const child = world.entities.createOrThrow([[unit, { label: "a", target: parent }]]);
  world.relations.add(childOf, child, parent);
  const checkpoint = world.captureCheckpoint([child], unit, childOf);
  world.components.setEntityData(unit, child, { label: "b", target: null });
  world.relations.remove(childOf, child, parent);
  world.applyCheckpoint(checkpoint);
  assertEquals(world.components.getEntityDataOrThrow(unit, child).label, "a", "String field restored");
  assertEquals(world.components.getEntityDataOrThrow(unit, child).target, parent, "Entity field restored");
  assertEquals(world.relations.getTarget(childOf, child), parent, "Relation pair restored");
});
