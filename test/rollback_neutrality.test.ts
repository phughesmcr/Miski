/// <reference lib="deno.ns" />

import {
  captureWorldRollbackPoint,
  commitWorldRollbackPoint,
  type DynamicComponent,
  type Entity,
  entityIndex,
  Query,
  restoreWorldRollbackPoint,
  type World,
} from "../mod.ts";
import { createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assertEquals } from "./helpers.ts";

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
      const entity = world.entities.getActiveSnapshot().find((candidate) => entityIndex(candidate) === slot)!;
      return world.components.getEntityData(position, entity);
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

    const point = captureWorldRollbackPoint(subject.world);
    const speculativeLive = [...subject.live];
    const speculation = rng(seed ^ 0x5bd1e995);
    const speculative: Harness = { world: subject.world, live: speculativeLive };
    for (let i = 0; i < 80; i++) step(speculative, speculation, components.length);
    restoreWorldRollbackPoint(subject.world, point);

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

Deno.test("committing a rollback point leaves allocation and iteration order untouched", async () => {
  const control = await harness();
  const subject = await harness();
  const a = rng(99);
  const b = rng(99);
  for (let i = 0; i < 100; i++) {
    step(control, a, components.length);
    step(subject, b, components.length);
  }
  commitWorldRollbackPoint(subject.world, captureWorldRollbackPoint(subject.world));
  for (let i = 0; i < 100; i++) {
    step(control, a, components.length);
    step(subject, b, components.length);
    assertEquals(observe(subject.world), observe(control.world), `Continuation diverged at step ${i}`);
  }
});
