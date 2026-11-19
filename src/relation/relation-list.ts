import {
  type BorrowedEntityIndices,
  type BorrowedEntityListEachFn,
  type BorrowedSlotIndices,
  createEntityArray,
  createSlotArray,
  type Entity,
  type EntityArray,
  ReusableEntityIterator,
  type SlotIndex,
} from "@/entity/entity.ts";

/** Initial buffer length; buffers double on demand up to the world capacity. */
const INITIAL_LENGTH = 16;

/**
 * Retained backing store for borrowed relation lists (targets, sources, query results and traversals).
 * Every list holds at most one entry per entity, so buffers never exceed the world capacity.
 */
export class RelationList {
  count: number = 0;
  /** Packed entity handles (re-pointed when the buffer grows). */
  entities: BorrowedEntityIndices;
  /** Storage slots parallel to {@link entities}. */
  slots: BorrowedSlotIndices;
  /** Pair rows parallel to {@link entities}; -1 for traversal roots. */
  rows: Int32Array;
  /** Traversal depths parallel to {@link entities}; empty for lists that are not traversals. */
  depths: Uint32Array;

  readonly #capacity: number;
  readonly #withDepths: boolean;
  #entityBuffer: Uint32Array;
  #slotBuffer: EntityArray;
  readonly #iterator: ReusableEntityIterator;

  constructor(capacity: number, withDepths: boolean) {
    this.#capacity = capacity;
    this.#withDepths = withDepths;
    const length = Math.min(capacity, INITIAL_LENGTH);
    this.#entityBuffer = createEntityArray(length);
    this.#slotBuffer = createSlotArray(capacity, length);
    this.rows = new Int32Array(length);
    this.depths = new Uint32Array(withDepths ? length : 0);
    this.entities = this.#entityBuffer as unknown as BorrowedEntityIndices;
    this.slots = this.#slotBuffer as unknown as BorrowedSlotIndices;
    this.#iterator = new ReusableEntityIterator(this.#entityBuffer);
  }

  #grow(): void {
    const next = Math.min(Math.max(this.#entityBuffer.length * 2, 1), this.#capacity);
    const entities = createEntityArray(next);
    const slots = createSlotArray(this.#capacity, next);
    const rows = new Int32Array(next);
    entities.set(this.#entityBuffer);
    slots.set(this.#slotBuffer);
    rows.set(this.rows);
    if (this.#withDepths) {
      const depths = new Uint32Array(next);
      depths.set(this.depths);
      this.depths = depths;
    }
    this.#entityBuffer = entities;
    this.#slotBuffer = slots;
    this.rows = rows;
    this.entities = entities as unknown as BorrowedEntityIndices;
    this.slots = slots as unknown as BorrowedSlotIndices;
    this.#iterator.indices = entities;
  }

  clear(): this {
    this.count = 0;
    return this;
  }

  push(entity: number, slot: number, row: number, depth: number): void {
    const index = this.count;
    if (index === this.#entityBuffer.length) this.#grow();
    this.#entityBuffer[index] = entity;
    this.#slotBuffer[index] = slot;
    this.rows[index] = row;
    if (this.#withDepths) this.depths[index] = depth;
    this.count = index + 1;
  }

  /** Storage slot of entry `index` (no bounds check). */
  slotAt(index: number): number {
    return this.#slotBuffer[index]!;
  }

  /** Reusable iterator over the valid packed handles. */
  iterate(): IterableIterator<Entity> {
    return this.#iterator.reset(this.count);
  }

  /** Zero-alloc dual walk: slot first (SoA), then packed handle (identity). */
  each(fn: BorrowedEntityListEachFn): void {
    const entities = this.#entityBuffer;
    const slots = this.#slotBuffer;
    const count = this.count;
    for (let i = 0; i < count; i++) {
      fn(slots[i]! as SlotIndex, entities[i]! as Entity, i);
    }
  }

  /** Iterate the valid packed handles; each call returns a fresh iterator, so nesting is safe. */
  *[Symbol.iterator](): IterableIterator<Entity> {
    for (let i = 0; i < this.count; i++) {
      yield this.#entityBuffer[i]! as Entity;
    }
  }
}
