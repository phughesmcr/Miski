/// <reference lib="deno.ns" />

import { type DynamicComponent, type Entity, entityIndex, Query, type World, WorldRollbackScope } from "../mod.ts";
import { createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals } from "./helpers.ts";

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

type Harness = {
  readonly world: World;
  readonly live: Entity[];
};

const position = vec2Component("position");
const tags = ["a", "b", "c", "d", "e"].map((name) => tagComponent(name));
const components: DynamicComponent[] = [position, ...tags];
const queries = [
  new Query({ all: [position] }),
  new Query({ all: [tags[0]!] }),
  new Query({ any: [tags[1]!, tags[2]!], none: [tags[3]!] }),
  new Query({ none: [tags[4]!] }),
];

/**
 * Apply one seeded operation. Entities are addressed by their position in `live`, so two worlds whose
 * slot allocation matches receive identical operations even though their handle generations differ.
 */
function step(h: Harness, random: Rng, componentLimit: number): void {
  const { world, live } = h;
  const op = random() % 6;
  if (op === 0 || live.length === 0) {
    const entity = world.entities.create();
    if (entity !== undefined) live.push(entity);
    return;
  }
  const index = random() % live.length;
  const entity = live[index]!;
  if (op === 1) {
    world.entities.destroy(entity);
    live.splice(index, 1);
    return;
  }
  const component = components[random() % componentLimit]!;
  if (op === 2 || op === 3) {
    if (component === position) {
      world.components.addToEntity(position, entity, { x: random() % 100, y: index });
    } else {
      world.components.addToEntity(component as (typeof tags)[number], entity);
    }
  } else if (op === 4) {
    world.components.removeFromEntity(component, entity);
  } else {
    world.refresh();
  }
}

function slots(iterable: Iterable<Entity> | undefined): number[] {
  return iterable === undefined ? [] : [...iterable].map((entity) => entityIndex(entity));
}

/** Slot-level observation of everything iteration-order sensitive code can see. */
function observe(world: World): unknown {
  return {
    active: slots(world.entities.getActive()),
    queries: queries.map((query) => {
      const list = world.entities.queryList(query);
      return {
        list: Array.from({ length: list.count }, (_, i) => list.slots[i]),
        entered: slots(world.entities.queryEntered(query)),
        exited: slots(world.entities.queryExited(query)),
      };
    }),
    owners: components.map((component) => slots(world.components.getOwners(component))),
    changed: slots(world.components.getChanged(position)),
    data: slots(world.components.getOwners(position)).map((slot) => {
      const entity = Array.from(world.entities.getActive()).find((candidate) => entityIndex(candidate) === slot)!;
      return world.components.getEntityDataOrThrow(position, entity);
    }),
  };
}

async function harness(): Promise<Harness> {
  return { world: await createTestWorld(components, 32), live: [] };
}

for (const seed of [1, 7, 42, 1337, 9001]) {
  Deno.test(`rollback restore is observationally neutral against a control world (seed ${seed})`, async () => {
    const control = await harness();
    const subject = await harness();

    // Shared prefix only touches the first three components, so speculation can create new archetypes.
    const prefixA = rng(seed);
    const prefixB = rng(seed);
    for (let i = 0; i < 120; i++) {
      step(control, prefixA, 3);
      step(subject, prefixB, 3);
    }

    const point = new WorldRollbackScope(subject.world);
    const speculativeLive = [...subject.live];
    const speculation = rng(seed ^ 0x5bd1e995);
    const speculative: Harness = { world: subject.world, live: speculativeLive };
    for (let i = 0; i < 80; i++) step(speculative, speculation, components.length);
    point.restore();

    assertEquals(observe(subject.world), observe(control.world), "Restore must reproduce the captured state");

    const continueA = rng(seed + 1);
    const continueB = rng(seed + 1);
    for (let i = 0; i < 200; i++) {
      step(control, continueA, components.length);
      step(subject, continueB, components.length);
      assertEquals(observe(subject.world), observe(control.world), `Continuation diverged at step ${i}`);
    }
  });
}

Deno.test("committing a rollback scope leaves allocation and iteration order untouched", async () => {
  const control = await harness();
  const subject = await harness();
  const a = rng(99);
  const b = rng(99);
  for (let i = 0; i < 100; i++) {
    step(control, a, components.length);
    step(subject, b, components.length);
  }
  new WorldRollbackScope(subject.world).commit();
  for (let i = 0; i < 100; i++) {
    step(control, a, components.length);
    step(subject, b, components.length);
    assertEquals(observe(subject.world), observe(control.world), `Continuation diverged at step ${i}`);
  }
});

function medianMs(fn: () => void, runs = 15): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[runs >> 1]!;
}

type RollbackCost = { readonly commit: number; readonly restore: number };

async function rollbackCost(capacity: number): Promise<RollbackCost> {
  const position = vec2Component("position");
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], capacity);
  for (let i = 0; i < 1000; i++) {
    world.entities.createOrThrow([[position, { x: i, y: i }], [velocity, { x: 1, y: 1 }]]);
  }
  const commit = medianMs(() => new WorldRollbackScope(world).commit());
  const restore = medianMs(() => new WorldRollbackScope(world).restore());
  await world.destroy();
  return { commit, restore };
}

Deno.test("rollback cost does not scale with world capacity", async () => {
  await rollbackCost(1024); // warm up
  const small = await rollbackCost(1024);
  const large = await rollbackCost(65536);
  // Same 1000 entities at 64x the capacity. Typed-array copies stay under ~0.6 ms here; the old
  // JSON/Array.from copies of every slot took ~7 ms to capture and ~15 ms to restore.
  for (const phase of ["commit", "restore"] as const) {
    assert(
      large[phase] < small[phase] * 10 + 1.5,
      `capture + ${phase} at 65536 took ${large[phase].toFixed(2)} ms vs ${small[phase].toFixed(2)} ms at 1024`,
    );
  }
});

Deno.test("rollback restore keeps query iteration order for reordered archetypes", async () => {
  const a = tagComponent("a");
  const world = await createTestWorld([a], 16);
  const entities = [0, 1, 2].map(() => world.entities.createOrThrow([[a]]));
  world.components.removeFromEntity(a, entities[0]!);
  world.components.addToEntity(a, entities[0]!);
  world.refresh();

  const query = new Query({ all: [a] });
  const order = (): number[] => {
    const list = world.entities.queryList(query);
    return Array.from({ length: list.count }, (_, i) => list.slots[i]!);
  };
  const before = order();
  new WorldRollbackScope(world).restore();
  assertEquals(order(), before, "A no-op rollback must not reorder query iteration");
});

Deno.test("rollback restore keeps the entity allocation cursor", async () => {
  const control = await createTestWorld([tagComponent("a")], 16);
  const subject = await createTestWorld([tagComponent("a")], 16);
  for (const world of [control, subject]) {
    const entities = [0, 1, 2, 3, 4].map(() => world.entities.createOrThrow());
    world.entities.destroy(entities[1]!);
    world.entities.destroy(entities[3]!);
  }
  const point = new WorldRollbackScope(subject);
  subject.entities.createOrThrow();
  subject.entities.createOrThrow();
  point.restore();

  const next = (world: World): number[] => [0, 1, 2].map(() => entityIndex(world.entities.createOrThrow()));
  assertEquals(next(subject), next(control), "Rollback must restore the next slots handed out");
});
