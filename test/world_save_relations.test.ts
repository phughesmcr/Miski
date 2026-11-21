/// <reference lib="deno.ns" />

// deno-lint-ignore-file no-await-in-loop -- worlds are built and checked one after another on purpose

/**
 * World saves of relations.
 *
 * A save keeps every relation's pairs, pair order, pair rows, pair data, free-row stack and changed sources. A world
 * loaded from a save must answer every relation read the same way as the saved world, keep behaving like it under
 * the same operations (same rows, same order, same cycle rejections), and re-save to identical bytes.
 */

import {
  Component,
  type DynamicComponent,
  type Entity,
  loadWorld,
  Query,
  Relation,
  saveWorld,
  World,
  type WorldSaveDocument,
  WorldSaveError,
  worldSaveFromDocument,
  worldSaveLayout,
  worldSaveToDocument,
} from "../mod.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type Defs = {
  readonly pos: Component<{ x: Float32ArrayConstructor }>;
  readonly childOf: Relation<{ weight: Float32ArrayConstructor }>;
  readonly likes: Relation<{ weight: Float32ArrayConstructor; rank: Int16ArrayConstructor }>;
  readonly follows: Relation<null>;
  readonly owns: Relation<null>;
};

function defsOf(): Defs {
  return {
    pos: new Component({ name: "pos", schema: { x: Float32Array } }),
    childOf: new Relation({
      name: "childOf",
      exclusive: true,
      acyclic: true,
      onDeleteTarget: "cascade",
      schema: { weight: Float32Array },
    }),
    likes: new Relation({ name: "likes", schema: { weight: Float32Array, rank: Int16Array } }),
    follows: new Relation({ name: "follows" }),
    owns: new Relation({ name: "owns", exclusive: true }),
  };
}

function relationsOf(defs: Defs): Relation<never>[] {
  return [defs.childOf, defs.likes, defs.follows, defs.owns] as unknown as Relation<never>[];
}

async function worldOf(defs: Defs, capacity = 64): Promise<World> {
  const world = new World({
    capacity,
    components: [defs.pos, defs.childOf, defs.likes, defs.follows, defs.owns] as DynamicComponent[],
  });
  await world.init();
  return world;
}

function list(l: { count: number; entities: { readonly [i: number]: number } }): number[] {
  return Array.from({ length: l.count }, (_, i) => l.entities[i]!);
}

function rowsOf(l: { count: number; rows: { readonly [i: number]: number } }): number[] {
  return Array.from({ length: l.count }, (_, i) => l.rows[i]!);
}

/** Everything a program can read about the world's relations, as plain data. */
function observe(world: World, defs: Defs): unknown {
  const live = Array.from(world.entities.getActive());
  const out: Record<string, unknown> = { live, pos: live.map((e) => world.components.getData(defs.pos, e)) };
  for (const def of relationsOf(defs)) {
    const r = world.relations;
    const perEntity = live.map((e) => {
      const targets = r.getTargets(def, e);
      const t = list(targets);
      const tr = rowsOf(targets);
      const sources = r.getSources(def, e);
      const data = t.map((target) => r.getData(def, e, target as Entity));
      const rowOf = t.map((target) => r.getInstanceOrThrow(def).rowOf(e, target as Entity));
      const subtree = r.traverse(def, e);
      return {
        e,
        t,
        tr,
        s: list(sources),
        sr: rowsOf(sources),
        data,
        rowOf,
        has: r.hasAny(def, e),
        first: r.getTarget(def, e),
        subtree: list(subtree),
        depths: Array.from({ length: subtree.count }, (_, i) => subtree.depths[i]),
      };
    });
    const all = r.getAllTargets(def);
    const forest = r.traverse(def);
    out[def.name] = {
      perEntity,
      all: list(all),
      allRows: rowsOf(all),
      forest: list(forest),
      forestDepths: Array.from({ length: forest.count }, (_, i) => forest.depths[i]),
      changed: [...r.getChanged(def)],
      members: Array.from(world.entities.query(new Query({ all: [def] }))),
    };
  }
  return out;
}

type Outcome = string;

/** One random operation, drawn once and applied to every twin so they can be compared. */
function drawOp(random: Rng, live: readonly Entity[], defs: Defs): (world: World) => Outcome {
  const op = random() % 100;
  const pick = (): Entity => live[random() % live.length]!;
  const relations = relationsOf(defs);
  if (op < 14 || live.length < 3) {
    return (world) => String(world.entities.create());
  }
  if (op < 20) {
    const e = pick();
    return (world) => {
      world.entities.destroy(e);
      return "destroy";
    };
  }
  if (op < 62) {
    const def = relations[random() % relations.length]!;
    const s = pick();
    const t = pick();
    const weight = (random() % 2000) / 8;
    const rank = (random() % 600) - 300;
    const data = def === (defs.likes as unknown) ?
      (random() % 3 === 0 ? { weight } : { weight, rank }) :
      def === (defs.childOf as unknown) ?
      { weight } :
      undefined;
    return (world) => {
      try {
        world.relations.add(def, s, t, data as never);
        return "added";
      } catch (error) {
        return `threw ${(error as Error).constructor.name}`;
      }
    };
  }
  if (op < 78) {
    const def = relations[random() % relations.length]!;
    const s = pick();
    const t = pick();
    const all = random() % 4 === 0;
    return (world) =>
      all ? `removeAll ${world.relations.removeAll(def, s)}` : `remove ${world.relations.remove(def, s, t)}`;
  }
  if (op < 86) {
    const def = random() % 2 === 0 ? defs.childOf : defs.likes;
    const s = pick();
    const t = pick();
    const weight = random() % 50;
    return (world) => {
      try {
        world.relations.setData(def as Relation<never>, s, t, { weight } as never);
        return "set";
      } catch (error) {
        return `threw ${(error as Error).constructor.name}`;
      }
    };
  }
  if (op < 92) {
    const e = pick();
    const x = random() % 100;
    return (world) => {
      if (!world.entities.isActive(e)) return "inactive";
      world.components.add(defs.pos, e, { x });
      return "pos";
    };
  }
  return (world) => {
    world.refresh();
    return "refresh";
  };
}

/** Run `steps` random operations on every world in `worlds`, checking that they agree. */
function runOps(random: Rng, worlds: readonly World[], defs: Defs, steps: number, label: string): void {
  for (let step = 0; step < steps; step++) {
    const live = Array.from(worlds[0]!.entities.getActive());
    const op = drawOp(random, live, defs);
    const outcomes = worlds.map((world) => op(world));
    for (let i = 1; i < worlds.length; i++) assertEquals(outcomes[i], outcomes[0], `${label} step ${step}: outcome`);
    if (worlds.length > 1 && step % 5 === 4) {
      const expected = observe(worlds[0]!, defs);
      for (let i = 1; i < worlds.length; i++) {
        assertEquals(observe(worlds[i]!, defs), expected, `${label} step ${step}: twin reads`);
      }
    }
  }
}

Deno.test("relations: save -> load into a fresh world reads the same and keeps behaving the same", async () => {
  const defs = defsOf();
  for (const seed of [1, 7, 42, 1234, 9001]) {
    const random = rng(seed);
    const world = await worldOf(defs);
    for (let round = 0; round < 6; round++) {
      runOps(random, [world], defs, 80, `seed ${seed} round ${round}`);
      const bytes = saveWorld(world);
      const fresh = await worldOf(defs);
      loadWorld(fresh, bytes);
      assertEquals(observe(fresh, defs), observe(world, defs), `seed ${seed} round ${round}: loaded reads`);
      assert(bytesEqual(saveWorld(fresh), bytes), `seed ${seed} round ${round}: re-save is byte-identical`);
      // Continue both with the same operations: same rows, order, cycle rejections and frees.
      runOps(random, [world, fresh], defs, 60, `seed ${seed} round ${round} twins`);
      assert(bytesEqual(saveWorld(fresh), saveWorld(world)), `seed ${seed} round ${round}: twins re-save equal`);
    }
  }
});

Deno.test("relations: loading replaces a busy world's pairs, pool and changed lists", async () => {
  const defs = defsOf();
  const source = await worldOf(defs);
  const busy = await worldOf(defs);
  runOps(rng(5), [source], defs, 400, "source");
  // A busy world with more pairs and a larger pool than the save.
  runOps(rng(6), [busy], defs, 900, "busy");
  const bytes = saveWorld(source);
  loadWorld(busy, bytes);
  assertEquals(observe(busy, defs), observe(source, defs), "loaded over a busy world");
  assert(bytesEqual(saveWorld(busy), bytes), "re-save is byte-identical");
  runOps(rng(8), [source, busy], defs, 200, "after load");
  assert(bytesEqual(saveWorld(busy), saveWorld(source)), "twins re-save equal");
});

Deno.test("relations: the layout records relation options and pair data types", async () => {
  const defs = defsOf();
  const world = await worldOf(defs);
  const layout = worldSaveLayout(world);
  assertEquals(layout.components[1], {
    name: "childOf",
    maxOwners: null,
    fields: null,
    relation: {
      exclusive: true,
      acyclic: true,
      onDeleteTarget: "cascade",
      fields: [{ name: "weight", type: "f32" }],
    },
  }, "exclusive acyclic cascade relation with data");
  assertEquals(layout.components[3]!.relation, {
    exclusive: false,
    acyclic: false,
    onDeleteTarget: "remove",
    fields: null,
  }, "multi-target relation without data");
  assertEquals(layout.components[0]!.relation, undefined, "plain components carry no relation entry");
});

Deno.test("relations: a save loads only into a world with the same relation options", async () => {
  const defs = defsOf();
  const world = await worldOf(defs);
  runOps(rng(3), [world], defs, 200, "source");
  const bytes = saveWorld(world);
  const variants: [string, Relation<never>][] = [
    ["exclusive", new Relation({ name: "childOf", acyclic: false, schema: { weight: Float32Array } }) as never],
    [
      "acyclic",
      new Relation({ name: "childOf", exclusive: true, onDeleteTarget: "cascade", schema: { weight: Float32Array } }),
    ] as never,
    [
      "cascade",
      new Relation({ name: "childOf", exclusive: true, acyclic: true, schema: { weight: Float32Array } }),
    ] as never,
    [
      "data type",
      new Relation({
        name: "childOf",
        exclusive: true,
        acyclic: true,
        onDeleteTarget: "cascade",
        schema: { weight: Float64Array },
      }),
    ] as never,
    [
      "no data",
      new Relation({ name: "childOf", exclusive: true, acyclic: true, onDeleteTarget: "cascade" }),
    ] as never,
  ];
  for (const [label, childOf] of variants) {
    const other = new World({
      capacity: 64,
      components: [defs.pos, childOf, defs.likes, defs.follows, defs.owns] as DynamicComponent[],
    });
    await other.init();
    const kept = other.entities.createOrThrow();
    assertThrows(() => loadWorld(other, bytes), WorldSaveError, "at component 1 (childOf");
    assertEquals(other.entities.isActive(kept), true, `${label}: rejected load leaves the world untouched`);
  }
  // A plain tag in place of the relation is a different layout too.
  const plain = new World({
    capacity: 64,
    components: [defs.pos, new Component({ name: "childOf" }), defs.likes, defs.follows, defs.owns] as never,
  });
  await plain.init();
  assertThrows(() => loadWorld(plain, bytes), WorldSaveError, "at component 1 (childOf");
});

Deno.test("relations: the JSON view round-trips pairs losslessly and reads plainly", async () => {
  const defs = defsOf();
  const world = await worldOf(defs, 16);
  const [a, b, c, d] = [0, 1, 2, 3].map(() => world.entities.createOrThrow()) as [Entity, Entity, Entity, Entity];
  world.relations.add(defs.childOf, b, a, { weight: 0.5 });
  world.relations.add(defs.likes, a, c, { weight: 1, rank: -2 });
  world.relations.add(defs.likes, a, d, { weight: 2, rank: 3 });
  world.relations.add(defs.likes, b, d, { weight: 3, rank: 4 });
  world.relations.remove(defs.likes, a, c);
  const bytes = saveWorld(world);
  const document = worldSaveToDocument(bytes);
  const likes = document.relations!["likes"]!;
  assertEquals(likes.highWater, 3, "pool high water");
  assertEquals(likes.freeRows, [0], "freed row");
  assertEquals(likes.sources, [
    { slot: slot(a), pairs: [{ row: 1, target: d, data: { weight: 2, rank: 3 } }] },
    { slot: slot(b), pairs: [{ row: 2, target: d, data: { weight: 3, rank: 4 } }] },
  ], "pairs by source");
  assertEquals(likes.targets, [{ slot: slot(d), sources: [slot(a), slot(b)] }], "target lists");
  assertEquals(likes.changed, [slot(a), slot(b)], "changed sources");
  assertEquals(document.relations!["childOf"], {
    highWater: 0,
    freeRows: [],
    sources: [{ slot: slot(b), pairs: [{ row: slot(b), target: a, data: { weight: 0.5 } }] }],
    targets: [{ slot: slot(a), sources: [slot(b)] }],
    changed: [slot(b)],
  }, "exclusive relation");
  assertEquals(
    document.relations!["follows"],
    { highWater: 0, freeRows: [], sources: [], targets: [], changed: [] },
    "empty relation",
  );
  const again = worldSaveFromDocument(JSON.parse(JSON.stringify(document)));
  assert(bytesEqual(again, bytes), "JSON view is lossless");

  // A larger random world too.
  const big = await worldOf(defs);
  runOps(rng(11), [big], defs, 600, "big");
  const bigBytes = saveWorld(big);
  assert(bytesEqual(worldSaveFromDocument(JSON.parse(JSON.stringify(worldSaveToDocument(bigBytes)))), bigBytes), "big");
});

/** Edit a copy of a document and check that it is rejected with a message including `includes`. */
function rejects(document: WorldSaveDocument, includes: string, edit: (doc: WorldSaveDocument) => void): void {
  const copy = JSON.parse(JSON.stringify(document)) as WorldSaveDocument;
  edit(copy);
  assertThrows(() => worldSaveFromDocument(copy), WorldSaveError, includes);
}

/** Storage slot of a handle. */
const slot = (entity: Entity): number => entity & 0xffff;

Deno.test("relations: inconsistent relation documents are rejected", async () => {
  const defs = defsOf();
  const world = await worldOf(defs, 16);
  const [a, b, c, d] = [0, 1, 2, 3].map(() => world.entities.createOrThrow()) as [Entity, Entity, Entity, Entity];
  world.relations.add(defs.childOf, b, a, { weight: 1 });
  world.relations.add(defs.childOf, c, b, { weight: 1 });
  world.relations.add(defs.likes, a, c, { weight: 1, rank: 1 });
  world.relations.add(defs.likes, a, d, { weight: 1, rank: 1 });
  world.relations.add(defs.likes, b, d, { weight: 1, rank: 1 });
  world.relations.remove(defs.likes, a, c);
  const document = worldSaveToDocument(saveWorld(world));
  type Pair = { row: number; target: number; data?: Record<string, unknown> };
  type R = {
    highWater: number;
    freeRows: number[];
    sources: { slot: number; pairs: Pair[] }[];
    targets: { slot: number; sources: number[] }[];
    changed: number[];
  };
  const rel = (doc: WorldSaveDocument, name: string): R => (doc.relations as unknown as Record<string, R>)[name]!;
  const [sa, sb, sc, sd] = [slot(a), slot(b), slot(c), slot(d)];

  // Sanity: the unedited copy is accepted.
  worldSaveFromDocument(JSON.parse(JSON.stringify(document)));

  rejects(document, "relations must be an object", (doc) => delete (doc as { relations?: unknown }).relations);
  rejects(document, 'relations["likes"] must be an object', (doc) => {
    delete (doc.relations as Record<string, unknown>)["likes"];
  });
  rejects(document, 'holds unknown relation "pos"', (doc) => {
    (doc.relations as Record<string, unknown>)["pos"] = rel(doc, "follows");
  });
  rejects(document, "targets an entity that is not live", (doc) => {
    rel(doc, "likes").sources[0]!.pairs[0]!.target += 1 << 16;
  });
  rejects(
    document,
    "targets an entity that is not live",
    (doc) => (rel(doc, "likes").sources[0]!.pairs[0]!.target = 9),
  );
  rejects(document, "target must be an integer from 0", (doc) => {
    rel(doc, "likes").sources[0]!.pairs[0]!.target = -1;
  });
  rejects(document, "targets an entity that is not live", (doc) => {
    rel(doc, "likes").sources[0]!.pairs[0]!.target = 64; // slot index == capacity
  });
  rejects(document, "repeats the pair", (doc) => {
    const r = rel(doc, "likes");
    r.sources[0]!.pairs.push({ ...r.sources[0]!.pairs[0]!, row: 0 });
    r.freeRows = [];
    r.targets[0]!.sources = [sa, sa, sb];
  });
  rejects(document, "sources do not match its presence tag owners", (doc) => {
    const r = rel(doc, "follows");
    r.highWater = 1;
    r.sources = [{ slot: sa, pairs: [{ row: 0, target: b }] }];
    r.targets = [{ slot: sb, sources: [sa] }];
  });
  rejects(document, "sources do not match its presence tag owners", (doc) => {
    const r = rel(doc, "likes");
    r.sources = [r.sources[1]!];
    r.targets = [{ slot: sd, sources: [sb] }];
    r.freeRows = [0, 1];
  });
  rejects(document, "is exclusive but source", (doc) => {
    const r = rel(doc, "childOf");
    r.sources[0]!.pairs.push({ row: sb, target: d, data: { weight: 1 } });
    r.targets.push({ slot: sd, sources: [sb] });
  });
  rejects(document, "pair rows are corrupt", (doc) => (rel(doc, "childOf").sources[0]!.pairs[0]!.row = 5));
  rejects(document, "pair rows are corrupt", (doc) => (rel(doc, "childOf").highWater = 1));
  rejects(document, "forms a cycle", (doc) => {
    // b -> c and c -> b.
    const r = rel(doc, "childOf");
    r.sources[0]!.pairs[0]!.target = c;
    r.targets = [{ slot: sc, sources: [sb] }, { slot: sb, sources: [sc] }];
  });
  rejects(document, "pair rows are corrupt", (doc) => (rel(doc, "likes").freeRows = [1]));
  rejects(document, "pair rows are corrupt", (doc) => (rel(doc, "likes").highWater = 2));
  rejects(document, "pair rows are corrupt", (doc) => (rel(doc, "likes").highWater = 4));
  rejects(document, "pair rows are corrupt", (doc) => (rel(doc, "likes").freeRows = [0, 0]));
  rejects(document, "target lists are corrupt", (doc) => (rel(doc, "likes").targets[0]!.sources = [sa]));
  rejects(document, "target lists are corrupt", (doc) => (rel(doc, "likes").targets[0]!.sources = [sa, sa]));
  rejects(document, "target lists are corrupt", (doc) => (rel(doc, "likes").targets[0]!.sources = [sa, sc]));
  rejects(document, "target lists are corrupt", (doc) => rel(doc, "likes").targets.push({ slot: sd, sources: [] }));
  rejects(document, "target lists are corrupt", (doc) => (rel(doc, "likes").targets = []));
  rejects(document, "target lists are corrupt", (doc) => (rel(doc, "likes").targets[0]!.slot = sc));
  rejects(document, "changed list is corrupt", (doc) => (rel(doc, "likes").changed = [sa, sc]));
  rejects(document, "changed list is corrupt", (doc) => (rel(doc, "likes").changed = [sa, sa]));
  rejects(document, "data must be an object", (doc) => delete rel(doc, "likes").sources[0]!.pairs[0]!.data);
  rejects(document, 'holds unknown field "speed"', (doc) => {
    rel(doc, "likes").sources[0]!.pairs[0]!.data!["speed"] = 1;
  });
  rejects(document, "must be an integer from -32768 to 32767", (doc) => {
    rel(doc, "likes").sources[0]!.pairs[0]!.data!["rank"] = 1e6;
  });
  rejects(document, "must be absent for a relation without data", (doc) => {
    rel(doc, "owns").sources = [{ slot: sa, pairs: [{ row: sa, target: b, data: {} }] }];
  });
});

/** Byte offset and payload length of the relation section of a save. */
function relationSection(bytes: Uint8Array): [number, number] {
  const u32 = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2);
  let offset = 40 + u32[5]!;
  for (let s = 0; s < u32[8]!; s++) {
    const tag = u32[offset >>> 2]! & 0xffff;
    const payload = u32[(offset >>> 2) + 1]!;
    if (tag === 5) return [offset + 8, payload];
    offset += 8 + payload;
  }
  throw new Error("no relation section");
}

Deno.test("relations: binary pair targets must be live handles in range", async () => {
  const defs = defsOf();
  const world = await worldOf(defs);
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  world.relations.add(defs.childOf, a, b, { weight: 1 });
  const bytes = saveWorld(world);
  const [start] = relationSection(bytes);
  const u32 = new Uint32Array(bytes.buffer);
  // childOf comes first: six counts, then free rows, sources, source pair counts, pair rows, pair targets.
  const w = start >>> 2;
  const free = u32[w + 1]!;
  const sources = u32[w + 2]!;
  const pairs = u32[w + 3]!;
  const at = w + 6 + free + sources * 2 + pairs;
  assertEquals(u32[at], b, "the patched word is the pair target");
  const target = await worldOf(defs);
  for (const handle of [0xffffffff, 64, b + (1 << 16), b + 1]) {
    const corrupt = bytes.slice();
    new Uint32Array(corrupt.buffer)[at] = handle;
    assertThrows(() => loadWorld(target, corrupt), WorldSaveError, "targets an entity that is not live");
  }
  loadWorld(target, bytes);
  assertEquals(target.relations.getTarget(defs.childOf, a), b, "the unpatched save loads");
});

Deno.test("relations: corrupt relation sections are rejected or load a world that keeps working", async () => {
  const defs = defsOf();
  const world = await worldOf(defs, 32);
  runOps(rng(21), [world], defs, 500, "source");
  const bytes = saveWorld(world);
  const [start, length] = relationSection(bytes);
  assert(length > 64, "the fixture has a sizeable relation section");
  const target = await worldOf(defs, 32);
  const kept = target.entities.createOrThrow();
  const before = observe(target, defs);
  const random = rng(99);
  let accepted = 0;
  for (let trial = 0; trial < 600; trial++) {
    const corrupt = bytes.slice();
    const view = new Uint32Array(corrupt.buffer);
    const flips = 1 + (random() % 3);
    for (let f = 0; f < flips; f++) {
      const word = (start >>> 2) + (random() % (length >>> 2));
      const kind = random() % 4;
      view[word] = kind === 0 ? view[word]! + 1 : kind === 1 ? view[word]! - 1 : kind === 2 ? random() % 40 : random();
    }
    try {
      loadWorld(target, corrupt);
    } catch (error) {
      assert(error instanceof WorldSaveError, `trial ${trial}: ${(error as Error).name} ${(error as Error).message}`);
      assertEquals(observe(target, defs), before, `trial ${trial}: rejected load leaves the world untouched`);
      continue;
    }
    // Accepted (for example a changed pair datum): the world must stay fully usable.
    accepted++;
    runOps(rng(trial), [target], defs, 40, `trial ${trial} continued`);
    const again = saveWorld(target);
    const twin = await worldOf(defs, 32);
    loadWorld(twin, again);
    assertEquals(observe(twin, defs), observe(target, defs), `trial ${trial}: accepted world round-trips`);
    // Reset the target for the next trial.
    loadWorld(target, saveWorld(await worldOf(defs, 32)));
    const fresh = target.entities.createOrThrow();
    assertEquals(fresh, kept, "reset target matches its first state");
    assertEquals(observe(target, defs), before, "reset target reads like before");
  }
  assert(accepted > 0 && accepted < 600, "some corruptions load (and keep working), most are rejected");
});

Deno.test("relations: saveWorld reuses a buffer and migrate carries relations", async () => {
  const defs = defsOf();
  const world = await worldOf(defs);
  runOps(rng(4), [world], defs, 300, "source");
  const buffer = new Uint8Array(saveWorld(world).byteLength + 64);
  buffer.fill(0xff); // every pad byte must be written, not inherited
  const written = saveWorld(world, buffer);
  assert(written.buffer === buffer.buffer, "written into the buffer");
  assert(bytesEqual(written, saveWorld(world)), "a save into a buffer matches a fresh save");

  // A newer world appends a tag; migrate the document by adding its empty entry.
  const extra = new Component({ name: "extra" });
  const newer = new World({
    capacity: 64,
    components: [defs.pos, defs.childOf, defs.likes, defs.follows, defs.owns, extra] as DynamicComponent[],
  });
  await newer.init();
  loadWorld(newer, saveWorld(world), {
    migrate: (document, layout) => ({
      ...document,
      layout,
      components: { ...document.components, extra: { owners: [], changed: [] } },
    }),
  });
  assertEquals(observe(newer, defs), observe(world, defs), "migrated world keeps its relations");
});
