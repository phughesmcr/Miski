/// <reference lib="deno.ns" />

/**
 * Full world save / load, the JSON view and migration hooks.
 *
 * The core property: a world loaded from a save is indistinguishable from the world that was saved. Both are driven
 * with the same seeded operation stream afterwards and must agree on every handle, every iteration order, every
 * window and every future allocation. Saving both after any step must also produce identical bytes.
 */

import {
  Component,
  type DynamicComponent,
  type Entity,
  entityIndex,
  loadWorld,
  Query,
  readWorldSaveHeader,
  saveWorld,
  World,
  WorldRollbackScope,
  type WorldSaveDocument,
  WorldSaveError,
  worldSaveFromDocument,
  worldSaveLayout,
  worldSaveToDocument,
  WorldStateError,
} from "../mod.ts";
import { Buffer } from "node:buffer";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

type Rng = () => number;

function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}

const BOSS_CAP = 3;
const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
const health = new Component({ name: "health", schema: { hp: Uint16Array } });
const mass = new Component({ name: "mass", schema: { kg: Float64Array, flags: Int8Array } });
const boss = new Component({ name: "boss", schema: { level: Uint8Array }, maxEntities: BOSS_CAP });
const leader = new Component({ name: "leader", maxEntities: 1 });
const tagA = new Component({ name: "tagA" });
const tagB = new Component({ name: "tagB" });
const tagC = new Component({ name: "tagC" });
const components: DynamicComponent[] = [position, health, mass, boss, leader, tagA, tagB, tagC];
const dataFields: Record<string, readonly string[]> = {
  position: ["x", "y"],
  health: ["hp"],
  mass: ["kg", "flags"],
  boss: ["level"],
};
const queries = [
  new Query({ all: [position] }),
  new Query({ all: [position, health], none: [tagA] }),
  new Query({ any: [tagA, tagB] }),
  new Query({ all: [health], any: [boss, tagC] }),
  new Query({ none: [position] }),
  new Query({ all: [mass], include: [tagB] }),
];

type Harness = { readonly world: World; live: Entity[] };

async function createWorld(capacity: number): Promise<World> {
  const world = new World({ capacity, components });
  await world.init();
  return world;
}

function payload(component: DynamicComponent, random: Rng): Record<string, number> | undefined {
  const fields = dataFields[component.name];
  if (fields === undefined) return undefined;
  const out: Record<string, number> = {};
  for (const field of fields) out[field] = random() % 100;
  return out;
}

/** One seeded operation; entities are addressed by position in `live`, so twin worlds receive identical streams. */
function step(h: Harness, random: Rng): void {
  const { world, live } = h;
  const op = random() % 10;
  if (op === 0 || live.length === 0) {
    const entity = world.entities.create();
    if (entity !== undefined) live.push(entity);
    return;
  }
  const index = random() % live.length;
  const entity = live[index]!;
  const component = components[random() % components.length]!;
  switch (op) {
    case 1: {
      world.entities.destroy(entity);
      live.splice(index, 1);
      return;
    }
    case 2:
    case 3: {
      if (
        component.maxEntities !== null && world.components.getOwnersSnapshot(component)!.length >= component.maxEntities
      ) {
        return;
      }
      world.components.addToEntity(component as typeof position, entity, payload(component, random) as never);
      return;
    }
    case 4: {
      world.components.removeFromEntity(component, entity);
      return;
    }
    case 5: {
      const data = payload(component, random);
      if (data !== undefined && world.components.entityHas(component, entity)) {
        world.components.setEntityData(component as typeof position, entity, data as never);
      }
      return;
    }
    case 6: {
      const spawned = world.entities.createWith([[position, { x: random() % 7, y: 1 }], [tagB]]);
      if (spawned !== undefined) live.push(spawned);
      return;
    }
    case 7: {
      if (random() % 3 === 0) world.refresh();
      return;
    }
    default: {
      const data = payload(component, random);
      if (data !== undefined && world.components.entityHas(component, entity)) {
        world.components.markChanged(component, entity);
      }
    }
  }
}

function handles(iterable: Iterable<Entity> | undefined): number[] {
  return iterable === undefined ? [] : [...iterable];
}

/** Everything order-sensitive code can observe, by full handle. */
function observe(world: World): unknown {
  return {
    active: handles(world.entities.getActive()),
    available: world.entities.getAvailableCount(),
    queries: queries.map((query) => {
      const list = world.entities.queryList(query);
      return {
        entities: Array.from({ length: list.count }, (_, i) => list.entities[i]),
        slots: Array.from({ length: list.count }, (_, i) => list.slots[i]),
        entered: handles(world.entities.queryEntered(query)),
        exited: handles(world.entities.queryExited(query)),
      };
    }),
    owners: components.map((component) => handles(world.components.getOwners(component))),
    changed: components.map((component) => handles(world.components.getChanged(component))),
    data: Object.keys(dataFields).map((name) => {
      const component = components.find((candidate) => candidate.name === name)!;
      return handles(world.components.getOwners(component)).map((entity) =>
        world.components.getEntityData(component as typeof position, entity as Entity)
      );
    }),
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Drive a world through a random prefix, with rollback scopes so slots carry retired speculative generations. */
function churn(h: Harness, random: Rng, steps: number): void {
  for (let i = 0; i < steps; i++) {
    if (random() % 97 === 0) {
      const point = new WorldRollbackScope(h.world);
      const live = [...h.live];
      const speculative: Harness = { world: h.world, live: [...h.live] };
      for (let j = 0; j < 20; j++) step(speculative, random);
      point.restore();
      h.live = live;
      continue;
    }
    step(h, random);
  }
}

const CAPACITIES = [8, 33, 64, 300];
const SEEDS = [1, 7, 42, 1337, 0xbeef];

for (const capacity of CAPACITIES) {
  for (const seed of SEEDS) {
    Deno.test(`a loaded world behaves identically to the saved one (capacity ${capacity}, seed ${seed})`, async () => {
      const source: Harness = { world: await createWorld(capacity), live: [] };
      churn(source, rng(seed), 400);

      // The target already holds unrelated state and archetypes registered in a different order.
      const target: Harness = { world: await createWorld(capacity), live: [] };
      churn(target, rng(seed ^ 0x9e3779b9), 150);

      const bytes = saveWorld(source.world);
      loadWorld(target.world, bytes);
      target.live = [...source.live];

      assertEquals(observe(target.world), observe(source.world), "Load must reproduce the saved state");
      assert(bytesEqual(saveWorld(target.world), bytes), "Re-saving a loaded world must reproduce the save");

      const a = rng(seed + 1);
      const b = rng(seed + 1);
      for (let i = 0; i < 300; i++) {
        step(source, a);
        step(target, b);
        assertEquals(observe(target.world), observe(source.world), `Continuation diverged at step ${i}`);
        if (i % 50 === 0) {
          assert(bytesEqual(saveWorld(target.world), saveWorld(source.world)), `Saves diverged at step ${i}`);
        }
      }
    });
  }
}

Deno.test("an archetype empty at save time keeps its registry position after load", async () => {
  const source = await createWorld(16);
  const e = source.entities.createOrThrow();
  source.components.addToEntity(tagA, e);
  source.components.addToEntity(tagB, e); // registers {A} then {A,B}
  source.components.removeFromEntity(tagA, e); // registers {B}; {A} is now empty
  const other = source.entities.createOrThrow();
  source.components.addToEntity(tagB, other);
  source.refresh();

  const target = await createWorld(16);
  loadWorld(target, saveWorld(source));
  const query = new Query({ any: [tagA, tagB] });
  for (const world of [source, target]) {
    const fresh = world.entities.createOrThrow();
    world.components.addToEntity(tagA, fresh); // reuses the empty {A} archetype
  }
  const order = (world: World): number[] => {
    const list = world.entities.queryList(query);
    return Array.from({ length: list.count }, (_, i) => list.entities[i]!);
  };
  assertEquals(order(target), order(source), "Query order must follow the saved archetype registry");
});

Deno.test("loading into the saved world itself is a no-op observationally", async () => {
  const h: Harness = { world: await createWorld(64), live: [] };
  churn(h, rng(3), 300);
  const before = observe(h.world);
  const bytes = saveWorld(h.world);
  loadWorld(h.world, bytes);
  assertEquals(observe(h.world), before, "Self-load must not change observable state");
  assert(bytesEqual(saveWorld(h.world), bytes), "Self-load must not change the save");
});

Deno.test("load bumps query revisions forward", async () => {
  const source = await createWorld(16);
  const target = await createWorld(16);
  const query = new Query({ all: [position] });
  const before = target.queryRevision(query);
  loadWorld(target, saveWorld(source));
  assert(target.queryRevision(query) > before, "Revision tokens must move forward on load");
});

Deno.test("saveWorld into a caller buffer writes the same bytes and returns a view of them", async () => {
  const h: Harness = { world: await createWorld(64), live: [] };
  churn(h, rng(11), 200);
  const expected = saveWorld(h.world);
  const length = expected.byteLength;
  assertStrictEquals(length % 8, 0, "Saves are 8-byte aligned");

  const backing = new ArrayBuffer(length + 64);
  const target = new Uint8Array(backing, 16, length + 8);
  target.fill(0xaa);
  const view = saveWorld(h.world, target);
  assertStrictEquals(view.buffer, backing, "the save is written into the caller's buffer");
  assertStrictEquals(view.byteOffset, 16, "the view starts at the target");
  assertStrictEquals(view.byteLength, length, "the view is exactly the save");
  assert(bytesEqual(view, expected), "a save into a buffer must match a fresh save");
  assertStrictEquals(target[length], 0xaa, "Bytes past the save are untouched");
  assertStrictEquals(saveWorld(h.world, target), view, "an unchanged length reuses the returned view");

  // The cached view is reused only for the same buffer, offset and length.
  const shifted = saveWorld(h.world, new Uint8Array(backing, 24, length + 8));
  assert(shifted !== view && shifted.byteOffset === 24, "another offset gets its own view");
  const otherBacking = new ArrayBuffer(length + 64);
  const other = saveWorld(h.world, new Uint8Array(otherBacking, 16, length + 8));
  assert(other.buffer === otherBacking && bytesEqual(other, expected), "another buffer gets its own view");
  const back = saveWorld(h.world, target);
  assert(back.buffer === backing && back.byteOffset === 16, "returning to the first target views it again");

  const exact = new Uint8Array(length);
  assertStrictEquals(saveWorld(h.world, exact), exact, "an exactly sized target is returned as is");

  // Reusing one roomy buffer after more mutation stays correct.
  const roomy = new Uint8Array(length * 4);
  saveWorld(h.world, roomy);
  churn(h, rng(12), 50);
  const again = saveWorld(h.world, roomy);
  assertStrictEquals(again.buffer, roomy.buffer, "still written into the reused buffer");
  assert(bytesEqual(again, saveWorld(h.world)), "Reused target must hold the new save");

  // Too small: a fresh buffer, the caller's left alone.
  const small = new Uint8Array(8).fill(0xaa);
  const fresh = saveWorld(h.world, small);
  assert(fresh.buffer !== small.buffer, "a target that is too small is not written");
  assert(small.every((byte) => byte === 0xaa), "nothing written into the small target");
  assert(bytesEqual(fresh, saveWorld(h.world)), "the fresh save is complete");

  assertThrows(() => saveWorld(h.world, new Uint8Array(backing, 4, length)), RangeError, "aligned");
});

Deno.test("readWorldSaveHeader describes a save without a world", async () => {
  const world = await createWorld(33);
  world.entities.createOrThrow();
  world.entities.createOrThrow();
  const bytes = saveWorld(world);
  const header = readWorldSaveHeader(bytes);
  assertStrictEquals(header.byteLength, bytes.byteLength, "byte length");
  assertStrictEquals(header.entityCount, 2, "entity count");
  assertEquals(header.layout, worldSaveLayout(world), "layout");
  assertStrictEquals(header.layout.capacity, 33, "capacity");
  assertEquals(
    header.layout.components.map((component) => component.name),
    components.map((component) => component.name),
    "layout keeps registration order",
  );
  assertEquals(
    header.layout.components[0],
    { name: "position", maxEntities: null, fields: [{ name: "x", type: "f32" }, { name: "y", type: "f32" }] },
    "data component layout",
  );
  assertEquals(header.layout.components[4], { name: "leader", maxEntities: 1, fields: null }, "tag layout");
  assertStrictEquals(typeof header.layoutHash, "string", "hash is a hex string");
  assertStrictEquals(header.layoutHash.length, 16, "hash is 64-bit");
});

Deno.test("saves load from misaligned Uint8Arrays and node:buffer Buffers", async () => {
  const source: Harness = { world: await createWorld(64), live: [] };
  churn(source, rng(21), 300);
  const bytes = saveWorld(source.world);
  const expected = observe(source.world);
  const header = readWorldSaveHeader(bytes);
  const json = worldSaveToDocument(bytes);
  const n = bytes.byteLength;

  for (let offset = 0; offset < 8; offset++) {
    const backing = new ArrayBuffer(n + offset);
    new Uint8Array(backing, offset, n).set(bytes);
    // Node's `Buffer#slice` returns a view, so a copy made with it would stay misaligned.
    const inputs: [string, Uint8Array][] = [
      ["Uint8Array", new Uint8Array(backing, offset, n)],
      ["Buffer", Buffer.from(backing, offset, n)],
    ];
    for (const [kind, input] of inputs) {
      const label = `${kind} at offset ${offset}`;
      assertEquals(readWorldSaveHeader(input), header, `${label}: header`);
      assertEquals(worldSaveToDocument(input), json, `${label}: JSON view`);
      const target = await createWorld(64);
      loadWorld(target, input);
      assertEquals(observe(target), expected, `${label}: load`);
      assert(bytesEqual(new Uint8Array(backing, offset, n), bytes), `${label}: input untouched`);
    }
  }
});

Deno.test("load rejects an uninitialized world, a rollback scope, and foreign bytes", async () => {
  const source = await createWorld(16);
  const bytes = saveWorld(source);
  assertThrows(() => loadWorld(new World({ capacity: 16, components }), bytes), WorldStateError, "");
  assertThrows(() => saveWorld(new World({ capacity: 16, components })), WorldStateError, "");

  const target = await createWorld(16);
  const point = new WorldRollbackScope(target);
  assertThrows(() => loadWorld(target, bytes), WorldStateError, "rollback");
  point.restore();

  assertThrows(() => loadWorld(target, new Uint8Array(64)), WorldSaveError, "magic");
  assertThrows(() => loadWorld(target, bytes.subarray(0, bytes.byteLength - 8)), WorldSaveError, "");
});

Deno.test("load rejects a layout mismatch with the first difference", async () => {
  const source = await createWorld(16);
  const bytes = saveWorld(source);

  const wider = new Component({ name: "position", schema: { x: Float64Array, y: Float32Array } });
  const swapped = await (async () => {
    const world = new World({ capacity: 16, components: [wider, ...components.slice(1)] });
    await world.init();
    return world;
  })();
  assertThrows(() => loadWorld(swapped, bytes), WorldSaveError, "position.x");

  assertThrows(() => loadWorld(new World({ capacity: 32, components }), bytes), WorldStateError, "");
  const bigger = await createWorld(32);
  assertThrows(() => loadWorld(bigger, bytes), WorldSaveError, "capacity");

  const reordered = new World({ capacity: 16, components: [health, position, ...components.slice(2)] });
  await reordered.init();
  assertThrows(() => loadWorld(reordered, bytes), WorldSaveError, "component 0");
});

Deno.test("corrupt saves throw and leave the target untouched; accepted saves stay consistent", async () => {
  const source: Harness = { world: await createWorld(40), live: [] };
  churn(source, rng(5), 300);
  const bytes = saveWorld(source.world);
  const target: Harness = { world: await createWorld(40), live: [] };
  churn(target, rng(6), 100);
  const before = saveWorld(target.world);
  const random = rng(77);
  let rejected = 0;
  for (let trial = 0; trial < 400; trial++) {
    const corrupt = bytes.slice();
    const flips = 1 + (random() % 3);
    for (let i = 0; i < flips; i++) corrupt[random() % corrupt.byteLength] = random() & 0xff;
    try {
      loadWorld(target.world, corrupt);
    } catch (error) {
      assert(error instanceof WorldSaveError, `Corruption must throw WorldSaveError, got ${String(error)}`);
      assert(bytesEqual(saveWorld(target.world), before), `Rejected load mutated the world (trial ${trial})`);
      rejected++;
      continue;
    }
    // An accepted load must leave a world that survives continued use and re-saves losslessly.
    const resaved = saveWorld(target.world);
    const twin = await createWorld(40);
    loadWorld(twin, resaved);
    assertEquals(observe(twin), observe(target.world), `Accepted corrupt load is inconsistent (trial ${trial})`);
    const live = handles(target.world.entities.getActive()) as Entity[];
    const h: Harness = { world: target.world, live };
    for (let i = 0; i < 30; i++) step(h, random);
    loadWorld(target.world, before);
  }
  assert(rejected > 100, `Expected most corruptions to be rejected, got ${rejected}`);
  for (let cut = 0; cut < bytes.byteLength; cut += 8) {
    assertThrows(() => loadWorld(target.world, bytes.subarray(0, cut)), WorldSaveError, "");
  }
});

Deno.test("the JSON view round-trips losslessly, including non-finite and negative-zero floats", async () => {
  const h: Harness = { world: await createWorld(33), live: [] };
  churn(h, rng(21), 250);
  const e = h.world.entities.createOrThrow();
  h.world.components.addToEntity(position, e, { x: 1, y: 2 });
  h.world.components.addToEntity(mass, e, { kg: 1, flags: -3 });
  const slot = entityIndex(e);
  const pos = h.world.components.getInstance(position)!.storage.partitions;
  const kg = h.world.components.getInstance(mass)!.storage.partitions;
  pos.x[slot] = Number.NaN;
  pos.y[slot] = -0;
  kg.kg[slot] = Number.NEGATIVE_INFINITY;

  const bytes = saveWorld(h.world);
  const doc = worldSaveToDocument(bytes);
  const reparsed = JSON.parse(JSON.stringify(doc)) as WorldSaveDocument;
  assert(bytesEqual(worldSaveFromDocument(reparsed), bytes), "bytes -> JSON -> bytes must be identical");
  assertStrictEquals(doc.format, "miski-world", "format tag");
  assertStrictEquals(doc.layout.capacity, 33, "capacity");
  assert(Array.isArray(doc.archetypes) && doc.archetypes.length >= 1, "archetypes listed");
  assertEquals(doc.archetypes[0]!.components, [], "root archetype first");
  assert(doc.components["position"] !== undefined, "components keyed by name");
});

Deno.test("migrate hooks run only on a layout mismatch and their result is validated", async () => {
  const oldPosition = new Component({ name: "pos", schema: { x: Float32Array, y: Float32Array } });
  const oldWorld = new World({ capacity: 16, components: [oldPosition, health] });
  await oldWorld.init();
  const e = oldWorld.entities.createOrThrow();
  oldWorld.components.addToEntity(oldPosition, e, { x: 3, y: 4 });
  oldWorld.components.addToEntity(health, e, { hp: 9 });
  oldWorld.refresh();
  const bytes = saveWorld(oldWorld);

  const newPosition = new Component({
    name: "position",
    schema: { x: Float32Array, y: Float32Array, z: Float32Array },
  });
  const newWorld = new World({ capacity: 16, components: [newPosition, health] });
  await newWorld.init();

  assertThrows(() => loadWorld(newWorld, bytes), WorldSaveError, "component 0");

  let calls = 0;
  loadWorld(newWorld, bytes, {
    migrate: (doc, target) => {
      calls++;
      assertEquals(target, worldSaveLayout(newWorld), "migrate receives the target layout");
      const old = doc.components["pos"]!;
      const values = old.values!;
      return {
        ...doc,
        layout: target,
        archetypes: doc.archetypes.map((archetype) => ({
          ...archetype,
          components: archetype.components.map((name) => name === "pos" ? "position" : name),
        })),
        components: {
          health: doc.components["health"]!,
          position: { ...old, values: { x: values["x"]!, y: values["y"]!, z: values["x"]!.map(() => 0) } },
        },
      };
    },
  });
  assertStrictEquals(calls, 1, "migrate called once");
  assertEquals(newWorld.components.getEntityData(newPosition, e), { x: 3, y: 4, z: 0 }, "migrated values");
  assertStrictEquals(newWorld.entities.isActive(e), true, "handles survive migration");

  let same = 0;
  loadWorld(newWorld, saveWorld(newWorld), { migrate: (doc) => (same++, doc) });
  assertStrictEquals(same, 0, "matching layouts skip migrate");

  const before = saveWorld(newWorld);
  assertThrows(() => loadWorld(newWorld, bytes, { migrate: (doc) => doc }), WorldSaveError, "component 0");
  assert(bytesEqual(saveWorld(newWorld), before), "A failed migration leaves the world untouched");
});

Deno.test("a loaded world shares no memory with the save bytes", async () => {
  const source: Harness = { world: await createWorld(300), live: [] };
  churn(source, rng(13), 400);
  const bytes = saveWorld(source.world);
  const pristine = bytes.slice();

  const target: Harness = { world: await createWorld(300), live: [] };
  loadWorld(target.world, bytes);
  const loaded = observe(target.world);
  bytes.fill(0xa5);
  assertEquals(observe(target.world), loaded, "Overwriting the save must not change the loaded world");

  bytes.set(pristine);
  loadWorld(target.world, bytes);
  target.live = handles(target.world.entities.getActive()) as Entity[];
  churn(target, rng(14), 200);
  target.world.refresh();
  assert(bytesEqual(bytes, pristine), "Using the loaded world must not write into the save");
});

Deno.test("documents keep a field named __proto__ as an own key", async () => {
  const unit = new Component({ name: "unit", schema: { v: Float32Array } });
  const world = new World({ capacity: 8, components: [unit] });
  await world.init();
  world.components.addToEntity(unit, world.entities.createOrThrow(), { v: 3 });
  // World names cannot be `__proto__`, but documents and save bytes are untrusted input.
  const text = JSON.stringify(worldSaveToDocument(saveWorld(world))).replaceAll('"v"', '"__proto__"');
  const bytes = worldSaveFromDocument(JSON.parse(text));
  const values = worldSaveToDocument(bytes).components["unit"]!.values!;
  assert(Object.hasOwn(values, "__proto__"), "the field is an own key");
  assertEquals(Object.getPrototypeOf(values), Object.prototype, "the record keeps a plain prototype");
  assertEquals(JSON.stringify(values), '{"__proto__":[3]}', "the values survive");
});
