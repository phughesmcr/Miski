/// <reference lib="deno.ns" />

import {
  asSlotIndex,
  Component,
  type DynamicComponent,
  type Entity,
  entityIndex,
  type World,
  WorldRollbackScope,
} from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, ids } from "./helpers.ts";

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // Low LCG bits cycle quickly; use the high bits.
    return state >>> 8;
  };
}

// Capacity above 256 uses 16-bit slot lists; populations above 16 force owner/changed list growth.
const CAPACITY = 1024;
const position = vec2Component("position");
const capped = new Component({
  name: "capped",
  schema: { hp: Float64Array, armor: Int16Array },
  maxEntities: 48,
});
const marker = tagComponent("marker");
const components: DynamicComponent[] = [position, capped, marker];

type Harness = { readonly world: World; readonly live: Entity[] };

function step(h: Harness, random: Rng): void {
  const { world, live } = h;
  const op = random() % 8;
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
  } else if (op === 3) {
    world.components.addToEntity(position, entity, { x: random() % 1000, y: index });
  } else if (op === 4) {
    if (ids(world.components.getOwners(capped)).length < 48 || world.components.entityHas(capped, entity)) {
      world.components.addToEntity(capped, entity, { hp: (random() % 1000) / 8, armor: -(random() % 300) });
    }
  } else if (op === 5) {
    world.components.addToEntity(marker, entity);
  } else if (op === 6) {
    world.components.removeFromEntity(components[random() % components.length]!, entity);
  } else if (random() % 4 === 0) {
    world.refresh();
  } else if (world.components.entityHas(position, entity)) {
    world.components.require(position).set(entity, "x", random() % 50);
  }
}

function slots(iterable: Iterable<Entity> | undefined): number[] {
  return iterable === undefined ? [] : [...iterable].map((entity) => entityIndex(entity));
}

function observe(world: World): unknown {
  const live = world.entities.getActiveSnapshot();
  const bySlot = new Map<number, Entity>(live.map((entity) => [entityIndex(entity), entity]));
  return {
    active: live.map((entity) => entityIndex(entity)),
    owners: components.map((component) => slots(world.components.getOwners(component))),
    changed: ([position, capped] as DynamicComponent[]).map((component) =>
      slots(world.components.getChanged(component))
    ),
    position: slots(world.components.getOwners(position)).map((slot) =>
      world.components.getEntityData(position, bySlot.get(slot)!)
    ),
    capped: slots(world.components.getOwners(capped)).map((slot) =>
      world.components.getEntityData(capped, bySlot.get(slot)!)
    ),
  };
}

for (const seed of [3, 29, 777]) {
  Deno.test(`grown, 16-bit and capped tracking survive rollback neutrally (seed ${seed})`, async () => {
    const control: Harness = { world: await createTestWorld(components, CAPACITY), live: [] };
    const subject: Harness = { world: await createTestWorld(components, CAPACITY), live: [] };
    const a = rng(seed);
    const b = rng(seed);
    for (let i = 0; i < 600; i++) {
      step(control, a);
      step(subject, b);
    }
    assert(ids(subject.world.components.getOwners(position)).length > 16, "Prefix must grow the owner list");

    const point = new WorldRollbackScope(subject.world);
    const speculation = rng(seed ^ 0x9e3779b9);
    const speculative: Harness = { world: subject.world, live: [...subject.live] };
    for (let i = 0; i < 900; i++) step(speculative, speculation);
    point.restore();

    assertEquals(observe(subject.world), observe(control.world), "Restore must reproduce the captured state");
    const continueA = rng(seed + 1);
    const continueB = rng(seed + 1);
    for (let i = 0; i < 400; i++) {
      step(control, continueA);
      step(subject, continueB);
    }
    assertEquals(observe(subject.world), observe(control.world), "Continuation must not diverge");
  });
}

Deno.test("rollback restores capped owners even when stray raw writes exhausted the dense rows", async () => {
  const health = new Component({ name: "health", schema: { hp: Float32Array }, maxEntities: 2 });
  const world = await createTestWorld([health], 16);
  const instance = world.components.require(health);
  const [a, b, c, d] = [createEntity(world), createEntity(world), createEntity(world), createEntity(world)];
  world.components.addToEntity(health, a, { hp: 10 });
  world.components.addToEntity(health, b, { hp: 20 });

  const point = new WorldRollbackScope(world);
  world.components.removeFromEntity(health, a);
  world.components.removeFromEntity(health, b);
  // Both dense rows now hold raw non-owner writes.
  instance.setAt(asSlotIndex(entityIndex(c)), "hp", 7);
  instance.setAt(asSlotIndex(entityIndex(d)), "hp", 8);
  point.restore();

  assertEquals(ids(world.components.getOwners(health)), [a, b], "Owners restored in order");
  assertEquals(world.components.getEntityData(health, a), { hp: 10 }, "First owner value restored");
  assertEquals(world.components.getEntityData(health, b), { hp: 20 }, "Second owner value restored");
  assert(!instance.has(c) && !instance.has(d), "Stray writes never grant ownership");
});

Deno.test("removing a capped component frees its dense row for the next owner", async () => {
  const health = new Component({ name: "health", schema: { hp: Float32Array, max: Float32Array }, maxEntities: 1 });
  const world = await createTestWorld([health], 16);
  const [a, b] = [createEntity(world), createEntity(world)];
  world.components.addToEntity(health, a, { hp: 1, max: 2 });
  world.components.removeFromEntity(health, a);
  assertEquals(
    world.components.require(health).getAt(asSlotIndex(entityIndex(a)), "hp"),
    undefined,
    "Removal unmaps the row",
  );
  world.components.addToEntity(health, b, { hp: 3 });
  assertEquals(world.components.getEntityData(health, b), { hp: 3, max: 0 }, "New owner row starts zeroed");
});

Deno.test("changed window is a sparse set: stale positions never count as membership", async () => {
  const world = await createTestWorld([position], CAPACITY);
  const entities = Array.from({ length: 40 }, () => createEntity(world));
  for (const entity of entities) world.components.addToEntity(position, entity, { x: 1, y: 1 });
  assertEquals(ids(world.components.getChanged(position)), entities, "Adds mark every new owner in order");
  world.refresh();
  assertEquals(ids(world.components.getChanged(position)), [], "Refresh empties the window");

  const instance = world.components.require(position);
  const [first, second, last] = [entities[0]!, entities[1]!, entities[39]!];
  instance.set(last, "x", 2);
  instance.set(first, "x", 2);
  instance.set(last, "y", 2);
  assertEquals(ids(world.components.getChanged(position)), [last, first], "Stale entries do not dedupe new marks");
  world.components.removeFromEntity(position, last);
  instance.set(second, "x", 2);
  assertEquals(ids(world.components.getChanged(position)), [first, second], "Removal unmarks and compacts");
});

Deno.test("getActive grows its scratch with the population and keeps slot order", async () => {
  const world = await createTestWorld([marker], CAPACITY);
  const created: Entity[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 37 * (round + 1); i++) created.push(createEntity(world));
    assertEquals(ids(world.entities.getActive()), created, `Round ${round} lists every live entity`);
  }
  while (world.entities.create() !== undefined) { /* fill to capacity */ }
  assertEquals(slots(world.entities.getActive()).length, CAPACITY, "A full world lists every slot");
  const range = slots(world.entities.getActive(asSlotIndex(10), asSlotIndex(20)));
  assertEquals(range, Array.from({ length: 10 }, (_, i) => 10 + i), "Bounded ranges list their slots");
});

Deno.test("rollback keeps allocation order and retires speculative handles at 16-bit capacity", async () => {
  const world = await createTestWorld([position], CAPACITY);
  const kept = Array.from({ length: 50 }, () => createEntity(world));
  for (let i = 0; i < kept.length; i += 3) world.entities.destroy(kept[i]!);

  const point = new WorldRollbackScope(world);
  const before = world.entities.getActiveSnapshot();
  const speculative = Array.from({ length: 30 }, () => createEntity(world));
  for (const entity of before.slice(0, 5)) world.entities.destroy(entity);
  point.restore();

  assertEquals(world.entities.getActiveSnapshot(), before, "Live handles restored exactly");
  for (const entity of speculative) {
    assert(!world.entities.isActive(entity), "Speculative handles stay retired");
  }
  const reissued = Array.from({ length: 30 }, () => createEntity(world));
  assertEquals(
    reissued.map((entity) => entityIndex(entity)),
    speculative.map((entity) => entityIndex(entity)),
    "Allocation order matches the captured cursor",
  );
  for (let i = 0; i < reissued.length; i++) assert(reissued[i] !== speculative[i], "Reissued slots get new handles");
});
