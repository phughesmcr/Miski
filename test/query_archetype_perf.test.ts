/// <reference lib="deno.ns" />

import {
  captureWorldRollbackPoint,
  commitWorldRollbackPoint,
  type DynamicComponent,
  type Entity,
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
        ` live=${[...world.archetypes.queryEntities(query)].join(",")}` +
        ` entered=${[...world.archetypes.queryEntered(query)].join(",")}` +
        ` exited=${[...world.archetypes.queryExited(query)].join(",")}`,
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
      const point = captureWorldRollbackPoint(world);
      const speculative = [...live];
      for (let i = 0; i < 15; i++) step(world, speculative, random);
      record(world, trace, `r${round}-speculative`);
      if (round % 12 === 5) {
        restoreWorldRollbackPoint(world, point);
        record(world, trace, `r${round}-restored`);
      } else {
        commitWorldRollbackPoint(world, point);
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
  // Golden captured before the per-archetype stamp, growable result and reusable iterator changes.
  assertEquals(fnv1a(trace.join("\n")), "895a6761", "Query view order diverged from the recorded golden trace");
});
