/// <reference lib="deno.ns" />

/**
 * Seeded differential tests: random operation streams run against a World and a naive reference model.
 *
 * After every operation the World must agree with the model on liveness, ownership, data, query membership,
 * entered / exited and changed sets. A twin "control" World runs the same stream minus every speculative scope that
 * is rolled back; rollback must leave the subject observationally identical to it (same handles, same orders).
 *
 * A failure message names the seed and step; rerun one seed by narrowing SEEDS.
 */

import {
  asSlotIndex,
  Component,
  type DynamicComponent,
  type Entity,
  entityIndex,
  Query,
  World,
  WorldRollbackScope,
} from "../mod.ts";
import { assert, assertEquals, assertStrictEquals } from "./helpers.ts";

const SEEDS = [1, 2, 3, 0xbeef, 0x5eed, 0xc0ffee, 12345, 987654321];
const STEPS = 1500;
/** Capacities below, between and at 32-bit word boundaries of the occupancy bitmap. */
const CAPACITIES = [8, 33, 64];
const BOSS_CAP = 3;

type Fields = Record<string, number>;

const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
const health = new Component({ name: "health", schema: { hp: Uint16Array } });
const boss = new Component({ name: "boss", schema: { level: Uint8Array }, maxOwners: BOSS_CAP });
const tagA = new Component({ name: "tagA" });
const tagB = new Component({ name: "tagB" });
const components: DynamicComponent[] = [position, health, boss, tagA, tagB];

/** Field names and value ranges per data component; tags have none. */
const fieldsOf: Record<string, readonly (readonly [string, number, number])[]> = {
  position: [["x", -100, 100], ["y", -100, 100]],
  health: [["hp", 0, 1000]],
  boss: [["level", 0, 255]],
  tagA: [],
  tagB: [],
};
const capOf: Record<string, number> = { boss: BOSS_CAP };
const isTag = (name: string): boolean => fieldsOf[name]!.length === 0;

type QueryShape = { all?: string[]; any?: string[]; none?: string[]; include?: string[] };
const byName: Record<string, DynamicComponent> = { position, health, boss, tagA, tagB };
const queryShapes: QueryShape[] = [
  { all: ["position"] },
  { all: ["position", "health"], none: ["tagA"] },
  { any: ["tagA", "tagB"] },
  { all: ["health"], any: ["boss", "tagB"] },
  { none: ["position"] },
  { all: ["boss"], include: ["health"] },
];
const toComponents = (names: string[] | undefined): DynamicComponent[] => (names ?? []).map((n) => byName[n]!);
const queries = queryShapes.map((shape) =>
  new Query({
    all: toComponents(shape.all),
    any: toComponents(shape.any),
    none: toComponents(shape.none),
    include: toComponents(shape.include),
  })
);

// --- Model -------------------------------------------------------------------------------------------------------

type Model = {
  /** Live entities in creation order, with their owned components (`null` data for tags). */
  live: Map<Entity, Map<string, Fields | null>>;
  readonly capacity: number;
  /** Next-fit allocation cursor: the next create takes the first free slot at or after it. */
  cursor: number;
  /** Handles destroyed or rolled back so far (must never be active again in these short runs). */
  dead: Entity[];
  /** Query membership at the start of the current refresh window. */
  windowStart: Set<Entity>[];
  /** Entities marked changed per data component in the current window. */
  changed: Map<string, Set<Entity>>;
};

function emptyModel(capacity: number): Model {
  return {
    capacity,
    cursor: 0,
    live: new Map(),
    dead: [],
    windowStart: queries.map(() => new Set()),
    changed: new Map(components.map((c) => [c.name, new Set()])),
  };
}

function cloneModel(model: Model): Model {
  return {
    capacity: model.capacity,
    cursor: model.cursor,
    live: new Map([...model.live].map(([e, owned]) => [e, new Map([...owned].map(([k, v]) => [k, v && { ...v }]))])),
    dead: [...model.dead],
    windowStart: model.windowStart.map((s) => new Set(s)),
    changed: new Map([...model.changed].map(([k, v]) => [k, new Set(v)])),
  };
}

function matches(shape: QueryShape, owned: Map<string, unknown>): boolean {
  if (shape.all && !shape.all.every((n) => owned.has(n))) return false;
  if (shape.any && shape.any.length > 0 && !shape.any.some((n) => owned.has(n))) return false;
  if (shape.none && shape.none.some((n) => owned.has(n))) return false;
  return true;
}

function membership(model: Model, q: number): Set<Entity> {
  const out = new Set<Entity>();
  for (const [entity, owned] of model.live) if (matches(queryShapes[q]!, owned)) out.add(entity);
  return out;
}

/** Predict the slot the next create takes (next-fit) and advance the model cursor. */
function allocateSlot(model: Model): number {
  const used = new Set<number>([...model.live.keys()].map(entityIndex));
  for (let i = 0; i < model.capacity; i++) {
    const slot = (model.cursor + i) % model.capacity;
    if (!used.has(slot)) {
      model.cursor = (slot + 1) % model.capacity;
      return slot;
    }
  }
  throw new Error("allocateSlot on a full model");
}

function ownerCount(model: Model, name: string): number {
  let count = 0;
  for (const owned of model.live.values()) if (owned.has(name)) count++;
  return count;
}

/** Attach (or upsert) a component in the model. New ownership starts at zero; provided fields merge. */
function modelAdd(model: Model, entity: Entity, name: string, data: Fields | undefined): void {
  const owned = model.live.get(entity)!;
  if (isTag(name)) {
    owned.set(name, null);
    return;
  }
  const existing = owned.get(name);
  if (existing === undefined) {
    const zeros: Fields = {};
    for (const [field] of fieldsOf[name]!) zeros[field] = 0;
    owned.set(name, { ...zeros, ...data });
    model.changed.get(name)!.add(entity);
  } else if (data !== undefined) {
    // Writes to an existing owner mark it changed only when a stored value actually differs.
    if (Object.entries(data).some(([field, value]) => existing![field] !== value)) model.changed.get(name)!.add(entity);
    Object.assign(existing!, data);
  }
}

function modelRemove(model: Model, entity: Entity, name: string): void {
  model.live.get(entity)!.delete(name);
  model.changed.get(name)!.delete(entity);
}

function modelRefresh(model: Model): void {
  model.windowStart = queries.map((_, q) => membership(model, q));
  for (const set of model.changed.values()) set.clear();
}

// --- Operations --------------------------------------------------------------------------------------------------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

type Op =
  | { kind: "create" }
  | { kind: "createBundle"; bundle: [string, Fields | undefined][] }
  | { kind: "destroy"; entity: Entity }
  | { kind: "add"; entity: Entity; name: string; data: Fields | undefined }
  | { kind: "remove"; entity: Entity; name: string }
  | { kind: "set"; entity: Entity; name: string; data: Fields }
  | { kind: "addBundle"; entity: Entity; bundle: [string, Fields | undefined][] }
  | { kind: "bulkAdd"; query: number; name: string }
  | { kind: "bulkRemove"; query: number; name: string }
  | { kind: "refresh" };

function randomData(rng: Rng, name: string, partial: boolean): Fields | undefined {
  if (isTag(name)) return undefined;
  if (partial && rng() < 0.25) return undefined;
  const data: Fields = {};
  for (const [field, lo, hi] of fieldsOf[name]!) {
    if (!partial || rng() < 0.7) data[field] = int(rng, lo, hi);
  }
  return data;
}

function randomBundle(rng: Rng): [string, Fields | undefined][] {
  const names = components.map((c) => c.name).filter(() => rng() < 0.4);
  return names.map((name) => [name, randomData(rng, name, true)]);
}

function randomOp(rng: Rng, model: Model): Op {
  const live = [...model.live.keys()];
  const roll = rng();
  if (live.length === 0 || roll < 0.1) return { kind: "create" };
  if (roll < 0.22) return { kind: "createBundle", bundle: randomBundle(rng) };
  if (roll < 0.34) return { kind: "destroy", entity: pick(rng, live) };
  const name = pick(rng, components).name;
  const entity = pick(rng, live);
  if (roll < 0.52) return { kind: "add", entity, name, data: randomData(rng, name, true) };
  if (roll < 0.64) return { kind: "remove", entity, name };
  if (roll < 0.72) {
    const owned = [...model.live.get(entity)!].filter(([, v]) => v !== null).map(([n]) => n);
    if (owned.length > 0) {
      const target = pick(rng, owned);
      return { kind: "set", entity, name: target, data: randomData(rng, target, false)! };
    }
    return { kind: "refresh" };
  }
  if (roll < 0.8) return { kind: "addBundle", entity, bundle: randomBundle(rng) };
  if (roll < 0.85) return { kind: "bulkAdd", query: int(rng, 0, queries.length - 1), name };
  if (roll < 0.9) return { kind: "bulkRemove", query: int(rng, 0, queries.length - 1), name };
  return { kind: "refresh" };
}

/** Would attaching these components push any capped component past its cap? */
function exceedsCap(model: Model, additions: Map<string, number>): boolean {
  for (const [name, added] of additions) {
    const cap = capOf[name];
    if (cap !== undefined && ownerCount(model, name) + added > cap) return true;
  }
  return false;
}

function bundleEntries(bundle: [string, Fields | undefined][]): [DynamicComponent, Fields?][] {
  return bundle.map(([name, data]) => (data === undefined ? [byName[name]!] : [byName[name]!, data]));
}

/** Set when the last {@link apply} hit a failure the model predicted (a cap overflow). */
let expectedFailure = false;

/** Apply `op` to a world. When `model` is given, also apply it there and check the predicted outcome. */
function apply(world: World, op: Op, model: Model | undefined, where: string): void {
  expectedFailure = false;
  /** Run an operation the model predicts will throw; the world must throw and stay unchanged (checked later). */
  const expectThrow = (fn: () => void): void => {
    expectedFailure = true;
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    assert(threw, `${where}: expected ${op.kind} to throw`);
  };

  switch (op.kind) {
    case "create": {
      const entity = world.entities.create();
      if (!model) return;
      if (model.live.size === model.capacity) {
        assertStrictEquals(entity, undefined, `${where}: create on a full world`);
        return;
      }
      assert(entity !== undefined && !model.live.has(entity), `${where}: create returns a fresh handle`);
      assertStrictEquals(entityIndex(entity), allocateSlot(model), `${where}: create takes the next-fit slot`);
      model.live.set(entity, new Map());
      return;
    }
    case "createBundle": {
      const entries = bundleEntries(op.bundle);
      const additions = new Map(op.bundle.map(([name]) => [name, 1]));
      if (model && exceedsCap(model, additions)) {
        expectThrow(() => world.entities.create(entries as never));
        return;
      }
      const entity = world.entities.create(entries as never);
      if (!model) return;
      if (model.live.size === model.capacity) {
        assertStrictEquals(entity, undefined, `${where}: create(bundle) on a full world`);
        return;
      }
      assert(entity !== undefined && !model.live.has(entity), `${where}: create(bundle) returns a fresh handle`);
      assertStrictEquals(entityIndex(entity), allocateSlot(model), `${where}: create(bundle) takes the next-fit slot`);
      model.live.set(entity, new Map());
      for (const [name, data] of op.bundle) modelAdd(model, entity, name, data);
      return;
    }
    case "destroy": {
      world.entities.destroy(op.entity);
      if (!model) return;
      for (const name of model.live.get(op.entity)!.keys()) model.changed.get(name)!.delete(op.entity);
      model.live.delete(op.entity);
      model.dead.push(op.entity);
      return;
    }
    case "add": {
      const component = byName[op.name]!;
      const call = (): void => world.components.addToEntity(component as never, op.entity, op.data as never);
      if (model && !model.live.get(op.entity)!.has(op.name) && exceedsCap(model, new Map([[op.name, 1]]))) {
        expectThrow(call);
        return;
      }
      call();
      if (model) modelAdd(model, op.entity, op.name, op.data);
      return;
    }
    case "remove": {
      world.components.removeFromEntity(byName[op.name]!, op.entity);
      if (model) modelRemove(model, op.entity, op.name);
      return;
    }
    case "set": {
      world.components.setEntityData(byName[op.name]! as never, op.entity, op.data as never);
      if (model) modelAdd(model, op.entity, op.name, op.data);
      return;
    }
    case "addBundle": {
      const entries = bundleEntries(op.bundle);
      const owned = model?.live.get(op.entity);
      const additions = new Map(op.bundle.filter(([name]) => !owned?.has(name)).map(([name]) => [name, 1]));
      if (model && exceedsCap(model, additions)) {
        expectThrow(() => world.components.addBundle(op.entity, entries as never));
        return;
      }
      world.components.addBundle(op.entity, entries as never);
      if (model) { for (const [name, data] of op.bundle) modelAdd(model, op.entity, name, data); }
      return;
    }
    case "bulkAdd": {
      const list = world.entities.queryList(queries[op.query]!);
      const component = byName[op.name]!;
      if (!model) {
        world.components.addToEntities(component as never, list);
        return;
      }
      const targets = [...membership(model, op.query)].filter((e) => !model.live.get(e)!.has(op.name));
      if (exceedsCap(model, new Map([[op.name, targets.length]]))) {
        expectThrow(() => world.components.addToEntities(component as never, list));
        return;
      }
      const changed = world.components.addToEntities(component as never, list);
      assertStrictEquals(changed, targets.length, `${where}: bulk add reports new owners`);
      for (const entity of targets) modelAdd(model, entity, op.name, undefined);
      return;
    }
    case "bulkRemove": {
      const list = world.entities.queryList(queries[op.query]!);
      const changed = world.components.removeFromEntities(byName[op.name]!, list);
      if (!model) return;
      const targets = [...membership(model, op.query)].filter((e) => model.live.get(e)!.has(op.name));
      assertStrictEquals(changed, targets.length, `${where}: bulk remove reports removed owners`);
      for (const entity of targets) modelRemove(model, entity, op.name);
      return;
    }
    case "refresh": {
      world.refresh();
      if (model) modelRefresh(model);
      return;
    }
  }
}

// --- Checks ------------------------------------------------------------------------------------------------------

const sorted = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b);

function checkAgainstModel(world: World, model: Model, where: string): void {
  assertStrictEquals(world.entities.getActiveCount(), model.live.size, `${where}: active count`);
  assertEquals(sorted(Array.from(world.entities.getActive())), sorted(model.live.keys()), `${where}: active set`);
  for (const entity of model.dead) assert(!world.entities.isActive(entity), `${where}: dead ${entity} is inactive`);

  for (const [entity, owned] of model.live) {
    for (const component of components) {
      const name = component.name;
      const has = owned.has(name);
      assertStrictEquals(world.components.entityHas(component, entity), has, `${where}: ${entity} has ${name}`);
      const expected = owned.get(name);
      if (has && expected) {
        assertEquals(
          world.components.getEntityDataOrThrow(component as never, entity) as unknown,
          expected,
          `${where}: ${entity} ${name} data`,
        );
      }
    }
  }

  for (const component of components) {
    const owners = Array.from(world.components.getOwners(component)) ?? [];
    const expectedOwners = [...model.live].filter(([, owned]) => owned.has(component.name)).map(([e]) => e);
    assertEquals(sorted(owners), sorted(expectedOwners), `${where}: ${component.name} owners`);
    if (!isTag(component.name)) {
      const changed = Array.from(world.components.getChanged(component)) ?? [];
      assertEquals(sorted(changed), sorted(model.changed.get(component.name)!), `${where}: ${component.name} changed`);
    }
  }

  for (let q = 0; q < queries.length; q++) {
    const now = membership(model, q);
    const list = world.entities.queryList(queries[q]!);
    const listed: number[] = [];
    for (let i = 0; i < list.count; i++) {
      const entity = list.entities[i]!;
      assertStrictEquals(list.slots[i], entityIndex(entity), `${where}: q${q}[${i}] slot matches handle`);
      listed.push(entity);
    }
    assertEquals(sorted(listed), sorted(now), `${where}: q${q} members`);
    const start = model.windowStart[q]!;
    const entered = [...now].filter((e) => !start.has(e));
    const exited = [...start].filter((e) => !now.has(e));
    assertEquals(sorted(world.entities.queryEntered(queries[q]!)), sorted(entered), `${where}: q${q} entered`);
    assertEquals(sorted(world.entities.queryExited(queries[q]!)), sorted(exited), `${where}: q${q} exited`);
  }
}

/**
 * Everything observable, in iteration order, so two worlds can be compared exactly.
 * Entities print as slots: rollback retires speculative handles, so the subject's generations run ahead of the
 * control's by design while slots and orders must match.
 */
function observe(world: World): string {
  const slots = (entities: Iterable<Entity>): string => [...entities].map(entityIndex).join(",");
  const parts: string[] = [`active=${slots(Array.from(world.entities.getActive()))}`];
  for (const component of components) {
    const owners = Array.from(world.components.getOwners(component)) ?? [];
    parts.push(`${component.name} owners=${slots(owners)}`);
    if (!isTag(component.name)) {
      parts.push(`${component.name} changed=${slots(Array.from(world.components.getChanged(component)) ?? [])}`);
      for (const entity of owners) {
        parts.push(
          `${entityIndex(entity)}:${JSON.stringify(world.components.getEntityDataOrThrow(component as never, entity))}`,
        );
      }
    }
  }
  for (const query of queries) {
    parts.push(
      `list=${slots(Array.from(world.entities.query(query)))}` +
        ` entered=${slots(world.entities.queryEntered(query))}` +
        ` exited=${slots(world.entities.queryExited(query))}`,
    );
  }
  return parts.join("\n");
}

/** The control world's live handle in the same slot as a subject handle. */
function controlHandle(world: World, entity: Entity): Entity {
  const slot = entityIndex(entity);
  const [handle] = Array.from(world.entities.getActive(asSlotIndex(slot), asSlotIndex(slot + 1)));
  assert(handle !== undefined, `control has no live entity in slot ${slot}`);
  return handle;
}

/** Replay a subject op on the control world, translating handles by slot. */
function replay(world: World, op: Op, subjectFailed: boolean): void {
  const translated = "entity" in op ? { ...op, entity: controlHandle(world, op.entity) } : op;
  try {
    apply(world, translated, undefined, "control");
  } catch (error) {
    if (!subjectFailed) throw error;
    return;
  }
  assert(!subjectFailed, `control accepted a ${op.kind} the subject rejected`);
}

async function newWorld(capacity: number): Promise<World> {
  const world = new World({ capacity, components });
  await world.init();
  return world;
}

async function run(seed: number, capacity: number): Promise<void> {
  const rng = mulberry32(seed);
  const subject = await newWorld(capacity);
  const control = await newWorld(capacity);
  let model = emptyModel(capacity);

  for (let step = 0; step < STEPS; step++) {
    const where = `seed ${seed} step ${step}`;
    if (rng() < 0.04) {
      // Speculative scope: random ops, then restore (control never sees them) or commit (control replays them).
      const commit = rng() < 0.4;
      const point = new WorldRollbackScope(subject);
      const speculative = cloneModel(model);
      const ops: [Op, boolean][] = [];
      const length = int(rng, 1, 12);
      for (let i = 0; i < length; i++) {
        const op = randomOp(rng, speculative);
        apply(subject, op, speculative, `${where} speculative ${i} ${JSON.stringify(op)}`);
        ops.push([op, expectedFailure]);
        checkAgainstModel(subject, speculative, `${where} speculative ${i} ${JSON.stringify(op)}`);
      }
      if (commit) {
        point.commit();
        for (const [op, failed] of ops) replay(control, op, failed);
        model = speculative;
      } else {
        point.restore();
        // Handles issued during the discarded scope are retired: later creates in their slots must not revive them.
        const known = new Set([...model.live.keys(), ...model.dead]);
        for (const entity of [...speculative.live.keys(), ...speculative.dead]) {
          if (!known.has(entity)) model.dead.push(entity);
        }
      }
      checkAgainstModel(subject, model, `${where} after ${commit ? "commit" : "restore"}`);
      assertEquals(observe(subject), observe(control), `${where}: rollback is observationally neutral`);
      continue;
    }
    const op = randomOp(rng, model);
    apply(subject, op, model, `${where} ${JSON.stringify(op)}`);
    replay(control, op, expectedFailure);
    checkAgainstModel(subject, model, `${where} ${JSON.stringify(op)}`);
  }
  assertEquals(observe(subject), observe(control), `seed ${seed}: final state`);
  await subject.destroy();
  await control.destroy();
}

for (const capacity of CAPACITIES) {
  for (const seed of SEEDS) {
    Deno.test(
      `random operation streams match the reference model (capacity ${capacity}, seed ${seed})`,
      () => run(seed, capacity),
    );
  }
}
