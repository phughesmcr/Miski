import {
  createSlotArray,
  type Entity,
  type EntityArray,
  entityIndex,
  ReusableSlotPackIterator,
} from "@/entity/entity.ts";
import { ComponentDataError, EntityNotFoundError, formatEntityNotActive } from "@/errors.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance } from "@/types/query.ts";
import type { SchemaOrNull, TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";
import type { Relation } from "./relation.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";
import { RelationList } from "./relation-list.ts";

/** Sentinel for "no row" / "no slot" in the linked lists. */
export const NONE = -1;

/** Initial pair pool size for multi-target relations; it doubles on demand. */
const INITIAL_ROWS = 16;

/** World services a relation store needs. */
export type RelationStoreHost = {
  readonly capacity: number;
  isActive(entity: Entity): boolean;
  packSlot(slot: number): Entity;
  /** Add or remove the relation's presence tag through the archetype path. */
  setPresence(instance: DynamicComponentInstance, entity: Entity, present: boolean): void;
  /** Issue a fresh component revision for `queryRevision`. */
  bumpRevision(instance: DynamicComponentInstance): void;
  archetypeAtSlot(slot: number): { isCandidate(query: QueryInstance): boolean } | undefined;
};

/** Pair records captured for rollback, O(pairs + targets + changed). */
export type RelationStoreSnapshot = {
  readonly highWater: number;
  readonly freeRows: Int32Array;
  readonly sources: Int32Array;
  readonly sourceCounts: Uint32Array;
  readonly rows: Int32Array;
  readonly rowTargets: Uint32Array;
  readonly rowNextByTarget: Int32Array;
  readonly rowPrevByTarget: Int32Array;
  readonly rowData: readonly TypedArray[];
  readonly targets: Int32Array;
  readonly targetHandles: Uint32Array;
  readonly targetHeads: Int32Array;
  readonly targetTails: Int32Array;
  readonly targetCounts: Uint32Array;
  readonly changed: Int32Array;
};

function columnConstructor(property: unknown): TypedArrayConstructor {
  return (Array.isArray(property) ? property[0] : property) as TypedArrayConstructor;
}

/**
 * World-local pair index for one relation.
 *
 * Every pair is a row. A row sits on two doubly linked lists: the source's targets and the target's sources,
 * both in insertion order. Lists are headed by storage slot (never by packed handle); the row keeps the target's
 * packed handle so a stale handle never matches. Exclusive relations use the source slot as the row, so they need
 * no pool; multi-target relations take rows from a free stack backed by a pool that doubles on demand.
 */
export class RelationStore {
  readonly relation: Relation<SchemaOrNull>;
  readonly instance: DynamicComponentInstance;
  readonly name: string;
  readonly exclusive: boolean;
  readonly acyclic: boolean;
  readonly cascade: boolean;
  readonly #host: RelationStoreHost;
  readonly #capacity: number;

  // Per-slot list heads.
  readonly sourceHead: Int32Array;
  readonly #sourceTail: Int32Array;
  readonly sourceCount: Uint32Array;
  readonly targetHead: Int32Array;
  readonly #targetTail: Int32Array;
  readonly targetCount: Uint32Array;
  /** Packed handle of each slot while it is a target. */
  readonly #targetHandle: Uint32Array;
  // Targets with at least one source, in first-targeted order.
  readonly #allNext: Int32Array;
  readonly #allPrev: Int32Array;
  #allHead: number = NONE;
  #allTail: number = NONE;
  // Dense list of slots with at least one target (rollback capture order).
  readonly #liveSources: EntityArray;
  readonly #liveSourceIndex: Int32Array;
  #liveSourceCount: number = 0;

  // Rows.
  #rowCapacity: number;
  #highWater: number = 0;
  rowSource: Int32Array;
  rowTarget: Uint32Array;
  #nextBySource: Int32Array;
  #prevBySource: Int32Array;
  nextByTarget: Int32Array;
  #prevByTarget: Int32Array;
  #freeRows: Int32Array;
  #freeCount: number = 0;

  // Pair data.
  readonly #keys: readonly string[];
  readonly #constructors: readonly TypedArrayConstructor[];
  readonly #columns: TypedArray[];
  /** Stable record whose columns are re-pointed when the pool grows; `null` without a schema. */
  readonly partitions: Record<string, TypedArray> | null;
  /** Staged canonical values, one 1-length column per key (and by key, for unknown-field checks). */
  readonly #scratch: Record<string, TypedArray>;
  readonly #scratchColumns: readonly TypedArray[];

  // Changed sources (sparse set).
  readonly #changedSlots: EntityArray;
  readonly #changedIndex: Int32Array;
  #changedCount: number = 0;
  readonly #changedIterator: ReusableSlotPackIterator;

  /** Structure revision; bumps on every pair change and never repeats, so caches keyed by it stay sound. */
  revision: number = 0;

  readonly targetsList: RelationList;
  readonly sourcesList: RelationList;
  readonly allTargetsList: RelationList;
  readonly queryResult: RelationList;
  readonly forest: RelationList;
  forestRevision: number = NONE;
  readonly subtree: RelationList;
  subtreeRevision: number = NONE;
  subtreeRoot: number = NONE;

  constructor(relation: Relation<SchemaOrNull>, instance: DynamicComponentInstance, host: RelationStoreHost) {
    const capacity = host.capacity;
    this.relation = relation;
    this.instance = instance;
    this.name = relation.name;
    this.exclusive = relation.exclusive;
    this.acyclic = relation.acyclic;
    this.cascade = relation.onDeleteTarget === "cascade";
    this.#host = host;
    this.#capacity = capacity;

    this.sourceHead = new Int32Array(capacity).fill(NONE);
    this.#sourceTail = new Int32Array(capacity).fill(NONE);
    this.sourceCount = new Uint32Array(capacity);
    this.targetHead = new Int32Array(capacity).fill(NONE);
    this.#targetTail = new Int32Array(capacity).fill(NONE);
    this.targetCount = new Uint32Array(capacity);
    this.#targetHandle = new Uint32Array(capacity);
    this.#allNext = new Int32Array(capacity).fill(NONE);
    this.#allPrev = new Int32Array(capacity).fill(NONE);
    this.#liveSources = createSlotArray(capacity);
    this.#liveSourceIndex = new Int32Array(capacity).fill(NONE);

    const rows = this.exclusive ? capacity : Math.min(INITIAL_ROWS, capacity);
    this.#rowCapacity = rows;
    this.rowSource = new Int32Array(rows);
    this.rowTarget = new Uint32Array(rows);
    this.#nextBySource = new Int32Array(rows);
    this.#prevBySource = new Int32Array(rows);
    this.nextByTarget = new Int32Array(rows);
    this.#prevByTarget = new Int32Array(rows);
    this.#freeRows = new Int32Array(this.exclusive ? 0 : rows);

    const schema = (relation.dataSchema ?? {}) as Record<string, unknown>;
    this.#keys = Object.freeze(Object.keys(schema));
    this.#constructors = this.#keys.map((key) => columnConstructor(schema[key]));
    this.#columns = this.#constructors.map((Ctor) => new Ctor(rows));
    const scratch: Record<string, TypedArray> = {};
    const scratchColumns = this.#constructors.map((Ctor, i) => (scratch[this.#keys[i]!] = new Ctor(1)));
    this.partitions = relation.dataSchema === null ? null : {};
    this.#syncPartitions();
    this.#scratch = scratch;
    this.#scratchColumns = scratchColumns;

    this.#changedSlots = createSlotArray(capacity);
    this.#changedIndex = new Int32Array(capacity).fill(NONE);
    this.#changedIterator = new ReusableSlotPackIterator(this.#changedSlots, host.packSlot);

    this.targetsList = new RelationList(capacity, false);
    this.sourcesList = new RelationList(capacity, false);
    this.allTargetsList = new RelationList(capacity, false);
    this.queryResult = new RelationList(capacity, false);
    this.forest = new RelationList(capacity, true);
    this.subtree = new RelationList(capacity, true);
  }

  #syncPartitions(): void {
    const partitions = this.partitions;
    if (partitions === null) return;
    for (let i = 0; i < this.#keys.length; i++) partitions[this.#keys[i]!] = this.#columns[i]!;
  }

  // ---------------------------------------------------------------- rows

  #ensureRows(length: number): void {
    if (length <= this.#rowCapacity) return;
    let next = this.#rowCapacity * 2;
    while (next < length) next *= 2;
    const grow = <T extends Int32Array | Uint32Array>(from: T, make: (n: number) => T): T => {
      const to = make(next);
      to.set(from);
      return to;
    };
    const i32 = (n: number): Int32Array => new Int32Array(n);
    this.rowSource = grow(this.rowSource, i32);
    this.rowTarget = grow(this.rowTarget, (n) => new Uint32Array(n));
    this.#nextBySource = grow(this.#nextBySource, i32);
    this.#prevBySource = grow(this.#prevBySource, i32);
    this.nextByTarget = grow(this.nextByTarget, i32);
    this.#prevByTarget = grow(this.#prevByTarget, i32);
    this.#freeRows = grow(this.#freeRows, i32);
    for (let i = 0; i < this.#columns.length; i++) {
      const column = new this.#constructors[i]!(next);
      column.set(this.#columns[i]!);
      this.#columns[i] = column;
    }
    this.#rowCapacity = next;
    this.#syncPartitions();
  }

  #allocRow(sourceSlot: number): number {
    if (this.exclusive) return sourceSlot;
    if (this.#freeCount > 0) return this.#freeRows[--this.#freeCount]!;
    if (this.#highWater === this.#rowCapacity) this.#ensureRows(this.#highWater + 1);
    return this.#highWater++;
  }

  /** Append a pair to both lists. The caller has checked that the pair does not exist. */
  #link(sourceSlot: number, target: Entity, targetSlot: number): number {
    const row = this.#allocRow(sourceSlot);
    this.rowSource[row] = sourceSlot;
    this.rowTarget[row] = target;

    const sourceTail = this.#sourceTail[sourceSlot]!;
    this.#prevBySource[row] = sourceTail;
    this.#nextBySource[row] = NONE;
    if (sourceTail === NONE) this.sourceHead[sourceSlot] = row;
    else this.#nextBySource[sourceTail] = row;
    this.#sourceTail[sourceSlot] = row;
    const sourceCountBefore = this.sourceCount[sourceSlot]!;
    this.sourceCount[sourceSlot] = sourceCountBefore + 1;
    if (sourceCountBefore === 0) {
      this.#liveSourceIndex[sourceSlot] = this.#liveSourceCount;
      this.#liveSources[this.#liveSourceCount++] = sourceSlot;
    }

    const targetTail = this.#targetTail[targetSlot]!;
    this.#prevByTarget[row] = targetTail;
    this.nextByTarget[row] = NONE;
    if (targetTail === NONE) this.targetHead[targetSlot] = row;
    else this.nextByTarget[targetTail] = row;
    this.#targetTail[targetSlot] = row;
    const targetCountBefore = this.targetCount[targetSlot]!;
    this.targetCount[targetSlot] = targetCountBefore + 1;
    if (targetCountBefore === 0) {
      this.#targetHandle[targetSlot] = target;
      this.#allPrev[targetSlot] = this.#allTail;
      this.#allNext[targetSlot] = NONE;
      if (this.#allTail === NONE) this.#allHead = targetSlot;
      else this.#allNext[this.#allTail] = targetSlot;
      this.#allTail = targetSlot;
    }
    this.revision++;
    return row;
  }

  /** Remove a pair from both lists and release its row. */
  #unlink(row: number): void {
    const sourceSlot = this.rowSource[row]!;
    const targetSlot = entityIndex(this.rowTarget[row]!);

    const prevS = this.#prevBySource[row]!;
    const nextS = this.#nextBySource[row]!;
    if (prevS === NONE) this.sourceHead[sourceSlot] = nextS;
    else this.#nextBySource[prevS] = nextS;
    if (nextS === NONE) this.#sourceTail[sourceSlot] = prevS;
    else this.#prevBySource[nextS] = prevS;
    const sourceCountAfter = this.sourceCount[sourceSlot]! - 1;
    this.sourceCount[sourceSlot] = sourceCountAfter;
    if (sourceCountAfter === 0) {
      const index = this.#liveSourceIndex[sourceSlot]!;
      const last = this.#liveSources[--this.#liveSourceCount]!;
      this.#liveSources[index] = last;
      this.#liveSourceIndex[last] = index;
      this.#liveSourceIndex[sourceSlot] = NONE;
    }

    const prevT = this.#prevByTarget[row]!;
    const nextT = this.nextByTarget[row]!;
    if (prevT === NONE) this.targetHead[targetSlot] = nextT;
    else this.nextByTarget[prevT] = nextT;
    if (nextT === NONE) this.#targetTail[targetSlot] = prevT;
    else this.#prevByTarget[nextT] = prevT;
    const targetCountAfter = this.targetCount[targetSlot]! - 1;
    this.targetCount[targetSlot] = targetCountAfter;
    if (targetCountAfter === 0) {
      const prev = this.#allPrev[targetSlot]!;
      const next = this.#allNext[targetSlot]!;
      if (prev === NONE) this.#allHead = next;
      else this.#allNext[prev] = next;
      if (next === NONE) this.#allTail = prev;
      else this.#allPrev[next] = prev;
      this.#allPrev[targetSlot] = NONE;
      this.#allNext[targetSlot] = NONE;
    }

    if (!this.exclusive) this.#freeRows[this.#freeCount++] = row;
    this.revision++;
  }

  /** Row of `sourceSlot -> target`, walking the shorter of the two lists. Both entities must be active. */
  findRow(sourceSlot: number, target: Entity, targetSlot: number): number {
    if (this.exclusive) {
      return this.sourceCount[sourceSlot] !== 0 && this.rowTarget[sourceSlot] === target ? sourceSlot : NONE;
    }
    if (this.sourceCount[sourceSlot]! <= this.targetCount[targetSlot]!) {
      for (let row = this.sourceHead[sourceSlot]!; row !== NONE; row = this.#nextBySource[row]!) {
        if (this.rowTarget[row] === target) return row;
      }
    } else {
      for (let row = this.targetHead[targetSlot]!; row !== NONE; row = this.nextByTarget[row]!) {
        if (this.rowSource[row] === sourceSlot) return row;
      }
    }
    return NONE;
  }

  /** Row of `source -> target`, or -1 when either is stale or the pair does not exist. */
  rowOf(source: Entity, target: Entity): number {
    if (!this.#host.isActive(source) || !this.#host.isActive(target)) return NONE;
    return this.findRow(entityIndex(source), target, entityIndex(target));
  }

  // ---------------------------------------------------------------- changed

  #markChanged(slot: number): void {
    if (this.#changedIndex[slot] !== NONE) return;
    this.#changedIndex[slot] = this.#changedCount;
    this.#changedSlots[this.#changedCount++] = slot;
  }

  #unmarkChanged(slot: number): void {
    const index = this.#changedIndex[slot]!;
    if (index === NONE) return;
    const last = this.#changedSlots[--this.#changedCount]!;
    this.#changedSlots[index] = last;
    this.#changedIndex[last] = index;
    this.#changedIndex[slot] = NONE;
  }

  changed(): IterableIterator<Entity> {
    return this.#changedIterator.reset(this.#changedCount);
  }

  clearChanged(): void {
    for (let i = 0; i < this.#changedCount; i++) this.#changedIndex[this.#changedSlots[i]!] = NONE;
    this.#changedCount = 0;
  }

  // ---------------------------------------------------------------- mutations

  #assertActive(entity: Entity): void {
    if (!this.#host.isActive(entity)) throw new EntityNotFoundError(formatEntityNotActive(entity));
  }

  /** Throw if `source -> target` would close a cycle. Walks the target's chain in O(depth). */
  #assertNoCycle(source: Entity, target: Entity): void {
    let current = target;
    for (let steps = 0; steps <= this.#capacity; steps++) {
      if (current === source) {
        throw new RangeError(`Relation "${this.name}" pair ${source} -> ${target} would form a cycle.`);
      }
      const slot = entityIndex(current);
      if (this.sourceCount[slot] === 0) return;
      current = this.rowTarget[slot] as Entity;
    }
  }

  /** Mark the source after losing a pair: changed while it keeps a target, untagged once it has none. */
  #afterSourceLoss(sourceSlot: number, source: Entity): void {
    if (this.sourceCount[sourceSlot] === 0) {
      this.#unmarkChanged(sourceSlot);
      this.#host.setPresence(this.instance, source, false);
    } else {
      this.#markChanged(sourceSlot);
    }
  }

  add(source: Entity, target: Entity, data: Readonly<Record<string, number | undefined>> | undefined): void {
    this.#assertActive(source);
    this.#assertActive(target);
    if (data !== undefined) this.#prepareData(data);
    const sourceSlot = entityIndex(source);
    const targetSlot = entityIndex(target);
    const existing = this.findRow(sourceSlot, target, targetSlot);
    if (existing !== NONE) {
      if (data !== undefined && this.#writeData(data, existing, false)) {
        this.#markChanged(sourceSlot);
        this.#host.bumpRevision(this.instance);
      }
      return;
    }
    if (this.acyclic) this.#assertNoCycle(source, target);
    let row: number;
    if (this.exclusive && this.sourceCount[sourceSlot] !== 0) {
      this.#unlink(sourceSlot);
      row = this.#link(sourceSlot, target, targetSlot);
    } else {
      row = this.#link(sourceSlot, target, targetSlot);
      if (this.sourceCount[sourceSlot] === 1) this.#host.setPresence(this.instance, source, true);
    }
    this.#writeData(data, row, true);
    this.#markChanged(sourceSlot);
    this.#host.bumpRevision(this.instance);
  }

  remove(source: Entity, target: Entity): boolean {
    const row = this.rowOf(source, target);
    if (row === NONE) return false;
    const sourceSlot = entityIndex(source);
    this.#unlink(row);
    this.#afterSourceLoss(sourceSlot, source);
    this.#host.bumpRevision(this.instance);
    return true;
  }

  removeAll(source: Entity): number {
    if (!this.#host.isActive(source)) return 0;
    const sourceSlot = entityIndex(source);
    let removed = 0;
    while (this.sourceHead[sourceSlot] !== NONE) {
      this.#unlink(this.sourceHead[sourceSlot]!);
      removed++;
    }
    if (removed > 0) {
      this.#afterSourceLoss(sourceSlot, source);
      this.#host.bumpRevision(this.instance);
    }
    return removed;
  }

  setData(source: Entity, target: Entity, data: Readonly<Record<string, number | undefined>>): void {
    const row = this.rowOf(source, target);
    if (row === NONE) throw new RangeError(`No "${this.name}" pair from ${source} to ${target}.`);
    this.#prepareData(data);
    if (this.#writeData(data, row, false)) {
      this.#markChanged(entityIndex(source));
      this.#host.bumpRevision(this.instance);
    }
  }

  /**
   * Validate every own field before any pair or storage change, staging canonical values without allocation.
   * Kept separate from the component write helpers so relation writes never widen their type feedback.
   */
  #prepareData(data: unknown): void {
    if (!isObject(data)) throw new TypeError(`Relation "${this.name}" data must be an object.`);
    const values = data as Record<string, unknown>;
    for (const key in values) {
      if (hasOwnProperty(values, key) && this.#scratch[key] === undefined) {
        throw new ComponentDataError(`Relation "${this.name}" does not define data field "${key}".`);
      }
    }
    for (let i = 0; i < this.#keys.length; i++) {
      const key = this.#keys[i]!;
      const value = hasOwnProperty(values, key) ? values[key] : undefined;
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ComponentDataError(`Relation "${this.name}" data field "${key}" must be a finite number.`);
      }
      canonicalizeStoredValue(this.name, key, value, this.#scratchColumns[i]!);
    }
  }

  /** Commit staged values to `row`; a new row resets absent fields to zero. @returns `true` if a value changed */
  #writeData(data: Readonly<Record<string, number | undefined>> | undefined, row: number, fresh: boolean): boolean {
    let changed = false;
    for (let i = 0; i < this.#keys.length; i++) {
      // `undefined` counts as absent, matching `RelationDataInput`.
      const key = this.#keys[i]!;
      const provided = data !== undefined && hasOwnProperty(data, key) && data[key] !== undefined;
      if (!provided && !fresh) continue;
      const value = provided ? this.#scratchColumns[i]![0]! : 0;
      const column = this.#columns[i]!;
      if (!Object.is(column[row], value)) {
        column[row] = value;
        changed = true;
      }
    }
    return changed;
  }

  readRow(row: number, out: Record<string, number>): void {
    for (let i = 0; i < this.#keys.length; i++) out[this.#keys[i]!] = this.#columns[i]![row]!;
  }

  /**
   * Drop every pair of a slot that is being destroyed: outgoing first (so self-pairs go once), then incoming.
   * Surviving sources that lose their last target lose the presence tag; `doomed` marks slots about to be destroyed.
   */
  detach(slot: number, doomed: Uint8Array): void {
    let touched = false;
    while (this.sourceHead[slot] !== NONE) {
      this.#unlink(this.sourceHead[slot]!);
      touched = true;
    }
    this.#unmarkChanged(slot);
    let row = this.targetHead[slot]!;
    while (row !== NONE) {
      const next = this.nextByTarget[row]!;
      const sourceSlot = this.rowSource[row]!;
      this.#unlink(row);
      if (doomed[sourceSlot] === 0) this.#afterSourceLoss(sourceSlot, this.#host.packSlot(sourceSlot));
      touched = true;
      row = next;
    }
    if (touched) this.#host.bumpRevision(this.instance);
  }

  // ---------------------------------------------------------------- reads

  fillTargets(source: Entity): RelationList {
    const list = this.targetsList.clear();
    if (!this.#host.isActive(source)) return list;
    for (let row = this.sourceHead[entityIndex(source)]!; row !== NONE; row = this.#nextBySource[row]!) {
      const target = this.rowTarget[row]!;
      list.push(target, entityIndex(target), row, 0);
    }
    return list;
  }

  fillSources(target: Entity): RelationList {
    const list = this.sourcesList.clear();
    if (!this.#host.isActive(target)) return list;
    for (let row = this.targetHead[entityIndex(target)]!; row !== NONE; row = this.nextByTarget[row]!) {
      const slot = this.rowSource[row]!;
      list.push(this.#host.packSlot(slot), slot, row, 0);
    }
    return list;
  }

  fillAllTargets(): RelationList {
    const list = this.allTargetsList.clear();
    for (let slot = this.#allHead; slot !== NONE; slot = this.#allNext[slot]!) {
      list.push(this.#targetHandle[slot]!, slot, this.targetHead[slot]!, 0);
    }
    return list;
  }

  fillQuery(query: QueryInstance, target: Entity): RelationList {
    const list = this.queryResult.clear();
    if (!this.#host.isActive(target)) return list;
    for (let row = this.targetHead[entityIndex(target)]!; row !== NONE; row = this.nextByTarget[row]!) {
      const slot = this.rowSource[row]!;
      if (this.#host.archetypeAtSlot(slot)?.isCandidate(query) === true) {
        list.push(this.#host.packSlot(slot), slot, row, 0);
      }
    }
    return list;
  }

  /** Breadth-first walk from one root, appending to `list`. `visited` is shared scratch, cleared by the caller. */
  #walk(list: RelationList, root: number, rootSlot: number, visited: Uint8Array): void {
    let head = list.count;
    visited[rootSlot] = 1;
    list.push(root, rootSlot, NONE, 0);
    while (head < list.count) {
      const slot = list.slotAt(head);
      const depth = list.depths[head]! + 1;
      head++;
      for (let row = this.targetHead[slot]!; row !== NONE; row = this.nextByTarget[row]!) {
        const child = this.rowSource[row]!;
        if (visited[child] !== 0) continue;
        visited[child] = 1;
        list.push(this.#host.packSlot(child), child, row, depth);
      }
    }
  }

  #clearVisited(list: RelationList, visited: Uint8Array): void {
    for (let i = 0; i < list.count; i++) visited[list.slotAt(i)] = 0;
  }

  traverse(root: Entity | undefined, visited: Uint8Array): RelationList {
    if (root === undefined) {
      if (this.forestRevision === this.revision) return this.forest;
      const list = this.forest.clear();
      for (let slot = this.#allHead; slot !== NONE; slot = this.#allNext[slot]!) {
        if (this.sourceCount[slot] === 0 && visited[slot] === 0) {
          this.#walk(list, this.#targetHandle[slot]!, slot, visited);
        }
      }
      this.#clearVisited(list, visited);
      this.forestRevision = this.revision;
      return list;
    }
    if (!this.#host.isActive(root)) {
      this.subtreeRevision = NONE;
      return this.subtree.clear();
    }
    if (this.subtreeRevision === this.revision && this.subtreeRoot === root) return this.subtree;
    const list = this.subtree.clear();
    this.#walk(list, root, entityIndex(root), visited);
    this.#clearVisited(list, visited);
    this.subtreeRevision = this.revision;
    this.subtreeRoot = root;
    return list;
  }

  // ---------------------------------------------------------------- checkpoints

  /** Ordered targets and data of one source. */
  capturePairs(source: Entity): { targets: Entity[]; data: Record<string, number>[] } {
    const targets: Entity[] = [];
    const data: Record<string, number>[] = [];
    if (!this.#host.isActive(source)) return { targets, data };
    for (let row = this.sourceHead[entityIndex(source)]!; row !== NONE; row = this.#nextBySource[row]!) {
      targets.push(this.rowTarget[row]! as Entity);
      const values: Record<string, number> = {};
      this.readRow(row, values);
      data.push(values);
    }
    return { targets, data };
  }

  /** Current exclusive target of a slot, or `undefined`. */
  parentOf(slot: number): Entity | undefined {
    return this.sourceCount[slot] === 0 ? undefined : this.rowTarget[this.sourceHead[slot]!]! as Entity;
  }

  /**
   * Replace every pair of `source` with `targets` in order, without cycle checks (the caller preflights them).
   * The presence tag changes only if the source gains its first or loses its last target.
   */
  replacePairs(source: Entity, targets: readonly Entity[], data: readonly Readonly<Record<string, number>>[]): void {
    const sourceSlot = entityIndex(source);
    // Unchanged pairs keep their place in each target's source list and do not count as a change.
    if (this.#hasPairs(sourceSlot, targets, data)) return;
    const hadTargets = this.sourceCount[sourceSlot] !== 0;
    while (this.sourceHead[sourceSlot] !== NONE) this.#unlink(this.sourceHead[sourceSlot]!);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      const targetSlot = entityIndex(target);
      if (this.findRow(sourceSlot, target, targetSlot) !== NONE) continue;
      const row = this.#link(sourceSlot, target, targetSlot);
      const values = data[i];
      for (let k = 0; k < this.#keys.length; k++) this.#columns[k]![row] = values?.[this.#keys[k]!] ?? 0;
    }
    const hasTargets = this.sourceCount[sourceSlot] !== 0;
    if (hasTargets) this.#markChanged(sourceSlot);
    else this.#unmarkChanged(sourceSlot);
    if (hadTargets !== hasTargets) this.#host.setPresence(this.instance, source, hasTargets);
    this.#host.bumpRevision(this.instance);
  }

  /** Whether `sourceSlot` already holds exactly these pairs, in this order, with this data. */
  #hasPairs(
    sourceSlot: number,
    targets: readonly Entity[],
    data: readonly Readonly<Record<string, number>>[],
  ): boolean {
    if (this.sourceCount[sourceSlot] !== targets.length) return false;
    let row = this.sourceHead[sourceSlot]!;
    for (let i = 0; i < targets.length; i++) {
      if (this.rowTarget[row] !== targets[i]) return false;
      const values = data[i];
      for (let k = 0; k < this.#keys.length; k++) {
        if (!Object.is(this.#columns[k]![row], values?.[this.#keys[k]!] ?? 0)) return false;
      }
      row = this.#nextBySource[row]!;
    }
    return true;
  }

  // ---------------------------------------------------------------- rollback

  captureState(): RelationStoreSnapshot {
    const sourceTotal = this.#liveSourceCount;
    const sources = new Int32Array(sourceTotal);
    const sourceCounts = new Uint32Array(sourceTotal);
    let pairTotal = 0;
    for (let i = 0; i < sourceTotal; i++) {
      const slot = this.#liveSources[i]!;
      sources[i] = slot;
      sourceCounts[i] = this.sourceCount[slot]!;
      pairTotal += this.sourceCount[slot]!;
    }
    const rows = new Int32Array(pairTotal);
    const rowTargets = new Uint32Array(pairTotal);
    const rowNextByTarget = new Int32Array(pairTotal);
    const rowPrevByTarget = new Int32Array(pairTotal);
    const rowData = this.#constructors.map((Ctor) => new Ctor(pairTotal));
    let k = 0;
    for (let i = 0; i < sourceTotal; i++) {
      for (let row = this.sourceHead[sources[i]!]!; row !== NONE; row = this.#nextBySource[row]!) {
        rows[k] = row;
        rowTargets[k] = this.rowTarget[row]!;
        rowNextByTarget[k] = this.nextByTarget[row]!;
        rowPrevByTarget[k] = this.#prevByTarget[row]!;
        for (let c = 0; c < rowData.length; c++) rowData[c]![k] = this.#columns[c]![row]!;
        k++;
      }
    }
    let targetTotal = 0;
    for (let slot = this.#allHead; slot !== NONE; slot = this.#allNext[slot]!) targetTotal++;
    const targets = new Int32Array(targetTotal);
    const targetHandles = new Uint32Array(targetTotal);
    const targetHeads = new Int32Array(targetTotal);
    const targetTails = new Int32Array(targetTotal);
    const targetCounts = new Uint32Array(targetTotal);
    let t = 0;
    for (let slot = this.#allHead; slot !== NONE; slot = this.#allNext[slot]!) {
      targets[t] = slot;
      targetHandles[t] = this.#targetHandle[slot]!;
      targetHeads[t] = this.targetHead[slot]!;
      targetTails[t] = this.#targetTail[slot]!;
      targetCounts[t] = this.targetCount[slot]!;
      t++;
    }
    const changed = new Int32Array(this.#changedCount);
    for (let i = 0; i < this.#changedCount; i++) changed[i] = this.#changedSlots[i]!;
    return {
      highWater: this.#highWater,
      freeRows: this.#freeRows.slice(0, this.#freeCount),
      sources,
      sourceCounts,
      rows,
      rowTargets,
      rowNextByTarget,
      rowPrevByTarget,
      rowData,
      targets,
      targetHandles,
      targetHeads,
      targetTails,
      targetCounts,
      changed,
    };
  }

  restoreState(snapshot: RelationStoreSnapshot): void {
    // Clear the current lists: O(current sources + targets).
    for (let i = 0; i < this.#liveSourceCount; i++) {
      const slot = this.#liveSources[i]!;
      this.sourceHead[slot] = NONE;
      this.#sourceTail[slot] = NONE;
      this.sourceCount[slot] = 0;
      this.#liveSourceIndex[slot] = NONE;
    }
    this.#liveSourceCount = 0;
    for (let slot = this.#allHead; slot !== NONE;) {
      const next = this.#allNext[slot]!;
      this.targetHead[slot] = NONE;
      this.#targetTail[slot] = NONE;
      this.targetCount[slot] = 0;
      this.#allNext[slot] = NONE;
      this.#allPrev[slot] = NONE;
      slot = next;
    }
    this.#allHead = NONE;
    this.#allTail = NONE;
    this.clearChanged();

    // The pool may have grown since capture; keep the larger arrays and restore the contents into them.
    if (!this.exclusive) {
      this.#ensureRows(snapshot.highWater);
      this.#highWater = snapshot.highWater;
      this.#freeRows.set(snapshot.freeRows);
      this.#freeCount = snapshot.freeRows.length;
    }

    let k = 0;
    for (let i = 0; i < snapshot.sources.length; i++) {
      const slot = snapshot.sources[i]!;
      const count = snapshot.sourceCounts[i]!;
      this.#liveSources[i] = slot;
      this.#liveSourceIndex[slot] = i;
      this.sourceCount[slot] = count;
      let prev = NONE;
      for (let j = 0; j < count; j++, k++) {
        const row = snapshot.rows[k]!;
        this.rowSource[row] = slot;
        this.rowTarget[row] = snapshot.rowTargets[k]!;
        this.nextByTarget[row] = snapshot.rowNextByTarget[k]!;
        this.#prevByTarget[row] = snapshot.rowPrevByTarget[k]!;
        this.#prevBySource[row] = prev;
        if (prev === NONE) this.sourceHead[slot] = row;
        else this.#nextBySource[prev] = row;
        for (let c = 0; c < this.#columns.length; c++) this.#columns[c]![row] = snapshot.rowData[c]![k]!;
        prev = row;
      }
      this.#nextBySource[prev] = NONE;
      this.#sourceTail[slot] = prev;
    }
    this.#liveSourceCount = snapshot.sources.length;

    let prevTarget = NONE;
    for (let i = 0; i < snapshot.targets.length; i++) {
      const slot = snapshot.targets[i]!;
      this.#targetHandle[slot] = snapshot.targetHandles[i]!;
      this.targetHead[slot] = snapshot.targetHeads[i]!;
      this.#targetTail[slot] = snapshot.targetTails[i]!;
      this.targetCount[slot] = snapshot.targetCounts[i]!;
      this.#allPrev[slot] = prevTarget;
      if (prevTarget === NONE) this.#allHead = slot;
      else this.#allNext[prevTarget] = slot;
      prevTarget = slot;
    }
    this.#allTail = prevTarget;

    for (let i = 0; i < snapshot.changed.length; i++) this.#markChanged(snapshot.changed[i]!);
    // A fresh revision: never reuse a value a cache may have seen.
    this.revision++;
  }
}
