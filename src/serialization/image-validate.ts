import { ENTITY_GEN_MASK, entityIndex, packEntity } from "@/entity/entity.ts";
import { ENTITY_REF_LIMIT, fail } from "./format.ts";
import type { SaveImage } from "./image-types.ts";

/** Per-slot scratch for relation checks, allocated on the first save with relations. */
type RelationScratch = {
  /** Generation of every live slot. */
  readonly generation: Uint32Array;
  /** Per-slot stamp (owner index + 1) for duplicate and lookup checks. */
  readonly stamp: Int32Array;
  /** Per-slot pair index or bucket cursor. */
  readonly slotPair: Int32Array;
  /** Pairs per target slot. */
  readonly targetCounts: Uint32Array;
  /** Exclusive target slot per source slot, or -1. */
  readonly parent: Int32Array;
  /** Cycle walk state per slot: 0 unvisited, 1 on the current path, 2 done. */
  readonly walk: Uint8Array;
};

/** Reusable per-capacity scratch for {@link validateImage}. */
export class ValidationScratch {
  readonly archetypeOf: Int32Array;
  readonly marks: Uint32Array;
  readonly changedMarks: Uint32Array;
  epoch = 0;
  /**
   * Per relation of the last validated image: its pair indices in target-list order (see `targetPairOrder`). Cleared
   * by the caller once used, so they do not outlive the load.
   */
  readonly relationOrders: Uint32Array[] = [];
  #relation: RelationScratch | undefined;
  /** Grow-only per-pair work space for `targetPairOrder`, two words per pair. */
  #pairWork: Uint32Array = new Uint32Array(0);

  constructor(capacity: number) {
    this.archetypeOf = new Int32Array(capacity);
    this.marks = new Uint32Array(capacity);
    this.changedMarks = new Uint32Array(capacity);
  }

  get relation(): RelationScratch {
    const capacity = this.marks.length;
    return this.#relation ??= {
      generation: new Uint32Array(capacity),
      stamp: new Int32Array(capacity),
      slotPair: new Int32Array(capacity),
      targetCounts: new Uint32Array(capacity),
      parent: new Int32Array(capacity),
      walk: new Uint8Array(capacity),
    };
  }

  get capacity(): number {
    return this.marks.length;
  }

  /** Work space of at least `2 * pairs` words; its contents are stale. */
  pairWork(pairs: number): Uint32Array {
    if (this.#pairWork.length < pairs * 2) this.#pairWork = new Uint32Array(pairs * 2);
    return this.#pairWork;
  }

  next(): number {
    if (this.epoch === 0xffffffff) {
      this.marks.fill(0);
      this.changedMarks.fill(0);
      this.epoch = 0;
    }
    return ++this.epoch;
  }
}

function bitSet(bits: Uint32Array, offset: number, index: number): boolean {
  return ((bits[offset + (index >>> 5)]! >>> (index & 31)) & 1) === 1;
}

/**
 * Check that an image describes a world the managers can hold: every live slot sits in exactly one archetype,
 * ownership matches archetype membership, caps hold, changed lists are subsets of owners, and the window refers to
 * real archetypes and slots.
 * @param knownPrefix - Leading archetypes already known to be distinct (they match a live registry)
 */
export function validateImage(image: SaveImage, scratch: ValidationScratch, knownPrefix: number): void {
  const capacity = image.capacity;
  const occupancy = image.occupancy;
  const tail = capacity & 31;
  if (tail !== 0 && (occupancy[occupancy.length - 1]! >>> tail) !== 0) fail("World save marks slots past capacity.");
  let live = 0;
  for (let i = 0; i < occupancy.length; i++) {
    let bits = occupancy[i]!;
    while (bits !== 0) {
      bits &= bits - 1;
      live++;
    }
  }
  if (live !== image.liveGeneration.length) fail("World save live entity count does not match occupancy.");
  // A live slot's next generation must differ from its current one, or destroying and re-creating it would
  // reissue the live handle.
  let k = 0;
  for (let word = 0; word < occupancy.length; word++) {
    let bits = occupancy[word]!;
    while (bits !== 0) {
      const slot = (word << 5) + (31 - Math.clz32(bits & -bits));
      // Handles keep only the masked generation bits, so compare those.
      if (((image.liveGeneration[k++]! ^ image.nextGeneration[slot]!) & ENTITY_GEN_MASK) === 0) {
        fail(`World save slot ${slot} would reissue its handle.`);
      }
      bits &= bits - 1;
    }
  }
  if (image.cursor >= capacity) fail("World save allocation cursor is out of range.");

  const componentCount = image.layout.components.length;
  const wordsPerSet = image.wordsPerSet;
  const bits = image.archetypeBits;
  const count = image.populations.length;
  const extra = componentCount & 31;
  for (let i = 0; i < count; i++) {
    const offset = i * wordsPerSet;
    if (extra !== 0 && (bits[offset + wordsPerSet - 1]! >>> extra) !== 0) {
      fail(`World save archetype ${i} names an unknown component.`);
    }
    if (i === 0) {
      for (let k = 0; k < wordsPerSet; k++) if (bits[k] !== 0) fail("World save root archetype is not empty.");
      continue;
    }
    if (i < knownPrefix) continue;
    for (let j = 0; j < i; j++) {
      let same = true;
      for (let k = 0; k < wordsPerSet; k++) {
        if (bits[offset + k] !== bits[j * wordsPerSet + k]) {
          same = false;
          break;
        }
      }
      if (same) fail(`World save archetypes ${j} and ${i} are identical.`);
    }
  }

  const archetypeOf = scratch.archetypeOf;
  archetypeOf.fill(-1);
  let population = 0;
  for (let i = 0; i < count; i++) {
    const slots = image.populations[i]!;
    for (let p = 0; p < slots.length; p++) {
      const slot = slots[p]!;
      if (slot >= capacity || ((occupancy[slot >>> 5]! >>> (slot & 31)) & 1) === 0) {
        fail(`World save archetype ${i} holds a slot that is not live.`);
      }
      if (archetypeOf[slot] !== -1) fail(`World save places slot ${slot} in two archetypes.`);
      archetypeOf[slot] = i;
    }
    population += slots.length;
  }
  if (population !== live) fail("World save leaves live slots outside every archetype.");

  const marks = scratch.marks;
  const changedMarks = scratch.changedMarks;
  for (let c = 0; c < componentCount; c++) {
    const component = image.components[c]!;
    const owners = component.owners;
    const cap = image.info.caps[c]!;
    if (cap !== 0 && owners.length > cap) fail(`World save component ${c} exceeds its owner cap.`);
    let expected = 0;
    for (let i = 0; i < count; i++) if (bitSet(bits, i * wordsPerSet, c)) expected += image.populations[i]!.length;
    if (expected !== owners.length) fail(`World save component ${c} owners do not match archetype membership.`);
    const epoch = scratch.next();
    for (let j = 0; j < owners.length; j++) {
      const slot = owners[j]!;
      const archetype = slot < capacity ? archetypeOf[slot]! : -1;
      if (archetype === -1 || !bitSet(bits, archetype * wordsPerSet, c)) {
        fail(`World save component ${c} lists a slot outside its archetypes.`);
      }
      if (marks[slot] === epoch) fail(`World save component ${c} lists slot ${slot} twice.`);
      marks[slot] = epoch;
    }
    const changed = component.changed;
    if (image.info.codes[c] === null && changed.length !== 0) fail(`World save tag component ${c} lists changes.`);
    for (let j = 0; j < changed.length; j++) {
      const slot = changed[j]!;
      if (slot >= capacity || marks[slot] !== epoch) fail(`World save component ${c} marks a non-owner changed.`);
      if (changedMarks[slot] === epoch) fail(`World save component ${c} marks slot ${slot} changed twice.`);
      changedMarks[slot] = epoch;
    }
    const limits = image.info.limits[c];
    if (limits !== null && limits !== undefined) {
      for (let r = 0; r < limits.length; r++) {
        const limit = limits[r]!;
        if (limit === 0) continue;
        const row = component.rows[r]!;
        for (let j = 0; j < row.length; j++) {
          const value = row[j]!;
          if (
            limit === ENTITY_REF_LIMIT ? value !== -1 && (value < 0 || entityIndex(value) >= capacity) : value >= limit
          ) {
            fail(`World save component ${c} holds a field value outside its type.`);
          }
        }
      }
    }
  }

  const epoch = scratch.next();
  const slots = image.windowSlots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot >= capacity || marks[slot] === epoch) fail("World save window lists a slot twice or out of range.");
    marks[slot] = epoch;
    const origin = image.windowOrigins[i]!;
    const handle = image.windowHandles[i]!;
    if (origin > count) fail("World save window refers to an unknown archetype.");
    if (origin === 0 ? handle !== 0 : handle > 0x7fffffff || entityIndex(handle) !== slot) {
      fail("World save window holds an invalid handle.");
    }
  }

  if (image.info.relations.length === 0) return;
  const generation = scratch.relation.generation;
  let g = 0;
  for (let word = 0; word < occupancy.length; word++) {
    let bits = occupancy[word]!;
    while (bits !== 0) {
      generation[(word << 5) + (31 - Math.clz32(bits & -bits))] = image.liveGeneration[g++]!;
      bits &= bits - 1;
    }
  }
  const orders = scratch.relationOrders;
  orders.length = image.info.relations.length;
  for (let r = 0; r < orders.length; r++) orders[r] = validateRelation(image, r, scratch);
}

function isLive(occupancy: Uint32Array, slot: number): boolean {
  return ((occupancy[slot >>> 5]! >>> (slot & 31)) & 1) === 1;
}

/**
 * Check one relation against the store's invariants, so the rollback restore it feeds can trust it: live, unique
 * sources that are exactly the presence tag's owners; changed sources among them; pair rows that, with the free
 * rows, fill the pool exactly (exclusive: row = source slot, no pool); live targets with matching generations; no
 * repeated pair; target lists that hold every pair once under its own target; and no cycle in an acyclic relation.
 * @returns the pair indices in target-list order (see `targetPairOrder`)
 */
function validateRelation(image: SaveImage, r: number, scratch: ValidationScratch): Uint32Array {
  const info = image.info.relations[r]!;
  const relation = image.relations[r]!;
  const capacity = image.capacity;
  const occupancy = image.occupancy;
  const bad = (problem: string): never => fail(`World save relation ${info.name} ${problem}.`);
  const { generation, stamp, targetCounts, parent, walk } = scratch.relation;
  const sources = relation.sources;
  const pairs = relation.rows.length;

  // Sources: live, unique, with at least one pair (exactly one when exclusive), and the presence tag's owners.
  const marks = scratch.marks;
  const epoch = scratch.next();
  let total = 0;
  for (let i = 0; i < sources.length; i++) {
    const slot = sources[i]!;
    if (slot >= capacity || !isLive(occupancy, slot)) bad("lists a source that is not live");
    if (marks[slot] === epoch) bad(`lists source ${slot} twice`);
    marks[slot] = epoch;
    const count = relation.sourceCounts[i]!;
    if (count === 0) bad(`source ${slot} has no targets`);
    if (info.exclusive && count !== 1) bad(`is exclusive but source ${slot} has ${count} targets`);
    total += count;
  }
  if (total !== pairs) bad("pair counts do not add up");
  const owners = image.components[info.component]!.owners;
  if (owners.length !== sources.length) bad("sources do not match its presence tag owners");
  for (let j = 0; j < owners.length; j++) {
    if (marks[owners[j]!] !== epoch) bad("sources do not match its presence tag owners");
  }
  const changedMarks = scratch.changedMarks;
  for (let i = 0; i < relation.changed.length; i++) {
    const slot = relation.changed[i]!;
    if (slot >= capacity || marks[slot] !== epoch || changedMarks[slot] === epoch) bad("changed list is corrupt");
    changedMarks[slot] = epoch;
  }

  // Rows: exclusive rows are the source slot; otherwise pair and free rows partition [0, highWater).
  if (info.exclusive) {
    if (relation.highWater !== 0 || relation.freeRows.length !== 0) bad("pair rows are corrupt");
    for (let i = 0; i < sources.length; i++) if (relation.rows[i] !== sources[i]) bad("pair rows are corrupt");
  } else {
    const highWater = relation.highWater;
    if (highWater !== pairs + relation.freeRows.length) bad("pair rows are corrupt");
    const used = new Uint8Array(highWater);
    for (const list of [relation.freeRows, relation.rows]) {
      for (let i = 0; i < list.length; i++) {
        const row = list[i]!;
        if (row >= highWater || used[row] !== 0) bad("pair rows are corrupt");
        used[row] = 1;
      }
    }
  }

  // Targets: live with the saved generation, never twice for one source.
  stamp.fill(0);
  targetCounts.fill(0);
  parent.fill(-1);
  let k = 0;
  for (let i = 0; i < sources.length; i++) {
    const slot = sources[i]!;
    const end = k + relation.sourceCounts[i]!;
    for (; k < end; k++) {
      const handle = relation.targets[k]!;
      const target = entityIndex(handle);
      if (
        handle > 0x7fffffff || target >= capacity || !isLive(occupancy, target) ||
        packEntity(target, generation[target]!) !== handle
      ) {
        bad("pair targets an entity that is not live");
      }
      if (stamp[target] === i + 1) bad(`repeats the pair ${slot} -> ${target}`);
      stamp[target] = i + 1;
      targetCounts[target]!++;
      parent[slot] = target;
    }
  }

  // Target lists: every target once, in any order the store could reach; each lists exactly its pairs' sources.
  const order = targetPairOrder(image, r, scratch);

  // Acyclic: walk each source's parent chain once.
  if (!info.acyclic) return order;
  walk.fill(0);
  for (let i = 0; i < sources.length; i++) {
    let slot = sources[i]!;
    while (slot !== -1 && walk[slot] === 0) {
      walk[slot] = 1;
      slot = parent[slot]!;
    }
    if (slot !== -1 && walk[slot] === 1) bad("forms a cycle");
    for (slot = sources[i]!; slot !== -1 && walk[slot] === 1; slot = parent[slot]!) walk[slot] = 2;
  }
  return order;
}

/**
 * Check a relation's target lists against its pairs and return the pair indices in target-list order (grouped by
 * target in first-targeted order). Expects `targetCounts` from {@link validateRelation}'s pair pass.
 */
function targetPairOrder(image: SaveImage, r: number, scratch: ValidationScratch): Uint32Array {
  const info = image.info.relations[r]!;
  const relation = image.relations[r]!;
  const capacity = image.capacity;
  const bad = (): never => fail(`World save relation ${info.name} target lists are corrupt.`);
  const { stamp, slotPair, targetCounts } = scratch.relation;
  const pairs = relation.rows.length;
  const targetSlots = relation.targetSlots;

  // Bucket the pairs by target, buckets in target-list order (slotPair holds each target's bucket cursor).
  const marks = scratch.marks;
  const epoch = scratch.next();
  let listed = 0;
  for (let t = 0; t < targetSlots.length; t++) {
    const slot = targetSlots[t]!;
    if (slot >= capacity || targetCounts[slot] === 0 || marks[slot] === epoch) bad();
    marks[slot] = epoch;
    slotPair[slot] = listed;
    listed += targetCounts[slot]!;
  }
  if (listed !== pairs) bad();
  // Words [0, pairs) bucket the pair indices; words [pairs, 2 * pairs) hold each pair's source slot.
  const work = scratch.pairWork(pairs);
  let k = 0;
  for (let i = 0; i < relation.sources.length; i++) {
    const end = k + relation.sourceCounts[i]!;
    for (; k < end; k++) {
      work[pairs + k] = relation.sources[i]!;
      work[slotPair[entityIndex(relation.targets[k]!)]!++] = k;
    }
  }

  // Each target's list must name each of its bucket's sources exactly once.
  const order = new Uint32Array(pairs);
  const byTarget = relation.sourcesByTarget;
  stamp.fill(0);
  let start = 0;
  for (let t = 0; t < targetSlots.length; t++) {
    const end = start + targetCounts[targetSlots[t]!]!;
    for (let j = start; j < end; j++) {
      const pair = work[j]!;
      const source = work[pairs + pair]!;
      stamp[source] = t + 1;
      slotPair[source] = pair;
    }
    for (let j = start; j < end; j++) {
      const source = byTarget[j]!;
      if (source >= capacity || stamp[source] !== t + 1) bad();
      stamp[source] = 0;
      order[j] = slotPair[source]!;
    }
    start = end;
  }
  return order;
}
