/// <reference lib="deno.ns" />

import {
  captureWorldRollbackPoint,
  type Entity,
  Query,
  Relation,
  restoreWorldRollbackPoint,
  type World,
  type WorldRollbackPoint,
} from "../mod.ts";
import { createTestWorld } from "./fixtures.ts";
import { assertEquals, listIds } from "./helpers.ts";

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}

/** Plain-array reference model of one relation: ordered forward and reverse lists. */
type RelationModel = {
  readonly exclusive: boolean;
  readonly acyclic: boolean;
  readonly cascade: boolean;
  fwd: Map<Entity, Entity[]>;
  rev: Map<Entity, Entity[]>;
  /** Targets with at least one source, in the order they gained their first source. */
  all: Entity[];
  data: Map<string, number>;
};

type Model = { live: Entity[]; relations: RelationModel[] };

function cloneModel(model: Model): Model {
  return {
    live: [...model.live],
    relations: model.relations.map((r) => ({
      ...r,
      fwd: new Map([...r.fwd].map(([k, v]) => [k, [...v]])),
      rev: new Map([...r.rev].map(([k, v]) => [k, [...v]])),
      all: [...r.all],
      data: new Map(r.data),
    })),
  };
}

function unlink(r: RelationModel, source: Entity, target: Entity): void {
  const targets = r.fwd.get(source)!;
  targets.splice(targets.indexOf(target), 1);
  if (targets.length === 0) r.fwd.delete(source);
  const sources = r.rev.get(target)!;
  sources.splice(sources.indexOf(source), 1);
  if (sources.length === 0) {
    r.rev.delete(target);
    r.all.splice(r.all.indexOf(target), 1);
  }
  r.data.delete(`${source}:${target}`);
}

function link(r: RelationModel, source: Entity, target: Entity, weight: number): void {
  const existing = r.fwd.get(source);
  if (existing?.includes(target)) {
    r.data.set(`${source}:${target}`, weight);
    return;
  }
  if (r.exclusive && existing !== undefined) unlink(r, source, existing[0]!);
  const targets = r.fwd.get(source) ?? [];
  targets.push(target);
  r.fwd.set(source, targets);
  let sources = r.rev.get(target);
  if (sources === undefined) {
    sources = [];
    r.rev.set(target, sources);
    r.all.push(target);
  }
  sources.push(source);
  r.data.set(`${source}:${target}`, weight);
}

function wouldCycle(r: RelationModel, source: Entity, target: Entity): boolean {
  let current: Entity | undefined = target;
  while (current !== undefined) {
    if (current === source) return true;
    current = r.fwd.get(current)?.[0];
  }
  return false;
}

function destroyModel(model: Model, entity: Entity): void {
  const doomed: Entity[] = [entity];
  for (let i = 0; i < doomed.length; i++) {
    for (const r of model.relations) {
      if (!r.cascade) continue;
      for (const source of r.rev.get(doomed[i]!) ?? []) if (!doomed.includes(source)) doomed.push(source);
    }
  }
  for (const e of doomed) {
    for (const r of model.relations) {
      for (const t of [...(r.fwd.get(e) ?? [])]) unlink(r, e, t);
      for (const s of [...(r.rev.get(e) ?? [])]) unlink(r, s, e);
    }
    model.live.splice(model.live.indexOf(e), 1);
  }
}

function traverseModel(r: RelationModel): [Entity[], number[]] {
  const order: Entity[] = [];
  const depths: number[] = [];
  for (const root of r.all) {
    if (r.fwd.has(root)) continue;
    const queue: [Entity, number][] = [[root, 0]];
    for (let i = 0; i < queue.length; i++) {
      const [e, d] = queue[i]!;
      order.push(e);
      depths.push(d);
      for (const child of r.rev.get(e) ?? []) queue.push([child, d + 1]);
    }
  }
  return [order, depths];
}

type WeightRelation = Relation<{ weight: Float32ArrayConstructor }>;

function check(world: World, defs: readonly WeightRelation[], model: Model, label: string): void {
  assertEquals(world.entities.getActiveCount(), model.live.length, `${label}: live count`);
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!;
    const r = model.relations[i]!;
    for (const e of model.live) {
      assertEquals(listIds(world.relations.getTargets(def, e)), r.fwd.get(e) ?? [], `${label}: ${def.name} targets`);
      assertEquals(listIds(world.relations.getSources(def, e)), r.rev.get(e) ?? [], `${label}: ${def.name} sources`);
      for (const t of r.fwd.get(e) ?? []) {
        assertEquals(
          world.relations.getData(def, e, t)?.weight,
          r.data.get(`${e}:${t}`),
          `${label}: ${def.name} data`,
        );
      }
    }
    assertEquals(listIds(world.relations.getAllTargets(def)), r.all, `${label}: ${def.name} all targets`);
    const members = listIds(world.entities.queryList(new Query({ all: [def] }))).sort((a, b) => a - b);
    assertEquals(members, [...r.fwd.keys()].sort((a, b) => a - b), `${label}: ${def.name} wildcard query`);
    if (r.exclusive) {
      const forest = world.relations.traverse(def);
      const [order, depths] = traverseModel(r);
      assertEquals(listIds(forest), order, `${label}: ${def.name} traversal order`);
      assertEquals(Array.from({ length: forest.count }, (_, k) => forest.depths[k]), depths, `${label}: depths`);
    }
  }
}

async function runSeed(seed: number, steps: number): Promise<void> {
  const defs = [
    new Relation({
      name: "childOf",
      exclusive: true,
      acyclic: true,
      onDeleteTarget: "cascade",
      schema: { weight: Float32Array },
    }),
    new Relation({ name: "likes", schema: { weight: Float32Array } }),
    new Relation({ name: "follows", exclusive: true, schema: { weight: Float32Array } }),
  ] as const;
  const world = await createTestWorld([...defs], 48);
  const model: Model = {
    live: [],
    relations: defs.map((d) => ({
      exclusive: d.exclusive,
      acyclic: d.acyclic,
      cascade: d.onDeleteTarget === "cascade",
      fwd: new Map(),
      rev: new Map(),
      all: [],
      data: new Map(),
    })),
  };
  const random = rng(seed);
  let saved: { point: WorldRollbackPoint; model: Model } | undefined;
  let current = model;

  for (let step = 0; step < steps; step++) {
    const op = random() % 100;
    const label = `seed ${seed} step ${step}`;
    if (op < 15 || current.live.length < 2) {
      const e = world.entities.create();
      if (e !== undefined) current.live.push(e);
    } else if (op < 22) {
      const e = current.live[random() % current.live.length]!;
      world.entities.destroy(e);
      destroyModel(current, e);
    } else if (op < 70) {
      const index = random() % defs.length;
      const s = current.live[random() % current.live.length]!;
      const t = current.live[random() % current.live.length]!;
      const weight = random() % 1000;
      const r = current.relations[index]!;
      if (r.acyclic && wouldCycle(r, s, t)) {
        let threw = false;
        try {
          world.relations.add(defs[index]!, s, t, { weight });
        } catch (error) {
          threw = error instanceof RangeError;
        }
        assertEquals(threw, true, `${label}: cycle rejected`);
      } else {
        world.relations.add(defs[index]!, s, t, { weight });
        link(r, s, t, weight);
      }
    } else if (op < 85) {
      const index = random() % defs.length;
      const r = current.relations[index]!;
      const sources = [...r.fwd.keys()];
      if (sources.length > 0) {
        const s = sources[random() % sources.length]!;
        const targets = r.fwd.get(s)!;
        if (random() % 4 === 0) {
          assertEquals(world.relations.removeAll(defs[index]!, s), targets.length, `${label}: removeAll count`);
          for (const t of [...targets]) unlink(r, s, t);
        } else {
          const t = targets[random() % targets.length]!;
          assertEquals(world.relations.remove(defs[index]!, s, t), true, `${label}: remove`);
          unlink(r, s, t);
        }
      }
    } else if (op < 90) {
      world.refresh();
    } else if (op < 95) {
      if (saved === undefined) {
        saved = { point: captureWorldRollbackPoint(world), model: cloneModel(current) };
      }
    } else if (saved !== undefined) {
      restoreWorldRollbackPoint(world, saved.point);
      current = saved.model;
      saved = undefined;
    }
    if (step % 7 === 0) check(world, defs, current, label);
  }
  check(world, defs, current, `seed ${seed} end`);
}

Deno.test("seeded relation operations match a reference model, including rollback", async () => {
  for (const seed of [1, 7, 42, 1234, 9001]) await runSeed(seed, 1500);
});
