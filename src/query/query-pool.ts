import { createEntityArray, createSlotArray, type EntityArray } from "@/entity/entity.ts";
import type {
  BorrowedEntityIndices,
  BorrowedEntityListEachFn,
  BorrowedSlotIndices,
  Entity,
  SlotIndex,
} from "@/entity/entity.ts";

/** Initial buffer length; buffers double on demand up to the world capacity. */
const INITIAL_RESULT_LENGTH = 16;

/** Unused list entries {@link QueryEntityResult.appendDense} will copy beyond the population to stay on memcpy. */
const BULK_COPY_SLACK = 64;

/**
 * Retained backing store for the public borrowed QueryEntityList view.
 *
 * Buffers are sized by the largest result seen, not by world capacity: they start small and double on demand
 * (capped at capacity). Growing re-points {@link entities}, {@link slots} and {@link entityBuffer}, so read
 * them from the result after each refill rather than holding on to an older reference.
 */
export class QueryEntityResult {
  #entityBuffer: Uint32Array;
  #slotBuffer: EntityArray;
  /** World entity capacity: the largest length a buffer ever needs, and the slot array's element width. */
  readonly #capacity: number;
  count: number = 0;
  /** Packed entity handles for identity (re-pointed when the buffer grows). */
  entities: BorrowedEntityIndices;
  /** Slot indices for SoA storage access (re-pointed when the buffer grows). */
  slots: BorrowedSlotIndices;

  /** @param capacity - The world's entity capacity */
  constructor(capacity: number) {
    this.#capacity = capacity;
    const length = Math.min(capacity, INITIAL_RESULT_LENGTH);
    this.#entityBuffer = createEntityArray(length);
    this.#slotBuffer = createSlotArray(capacity, length);
    this.entities = this.#entityBuffer as unknown as BorrowedEntityIndices;
    this.slots = this.#slotBuffer as unknown as BorrowedSlotIndices;
  }

  /** Grow both buffers so they can hold `length` entries, keeping the first {@link count}. */
  reserve(length: number): void {
    if (length <= this.#entityBuffer.length) return;
    let next = Math.max(this.#entityBuffer.length * 2, 1);
    while (next < length) next *= 2;
    next = Math.min(next, Math.max(this.#capacity, length));
    const entities = createEntityArray(next);
    const slots = createSlotArray(this.#capacity, next);
    entities.set(this.#entityBuffer.subarray(0, this.count));
    slots.set(this.#slotBuffer.subarray(0, this.count));
    this.#entityBuffer = entities;
    this.#slotBuffer = slots;
    this.entities = entities as unknown as BorrowedEntityIndices;
    this.slots = slots as unknown as BorrowedSlotIndices;
  }

  add(entity: Entity, slot: SlotIndex): void {
    const index = this.count;
    if (index === this.#entityBuffer.length) this.reserve(index + 1);
    this.#entityBuffer[index] = entity;
    this.#slotBuffer[index] = slot;
    this.count = index + 1;
  }

  /**
   * Append parallel dense slot and packed-handle lists (an archetype's population, in iteration order).
   *
   * When the backing lists are at most about twice the population, they are copied whole with `TypedArray.set`
   * (a memcpy) rather than bounded by `count`, because bounding would allocate a `subarray` view per call. The
   * extra tail lands past {@link count}, where entries are already documented as invalid, and the next append
   * overwrites it; the buffers grow to hold it, so they can reach about twice the largest result.
   * @param slots - Dense slots
   * @param handles - Packed handles, `handles[i]` belonging to `slots[i]`; same length as `slots`
   * @param count - Number of leading entries to append
   */
  appendDense(slots: EntityArray, handles: Uint32Array, count: number): void {
    const start = this.count;
    const listLength = slots.length;
    const bulk = listLength - count <= count + BULK_COPY_SLACK;
    const needed = start + (bulk ? listLength : count);
    if (needed > this.#entityBuffer.length) this.reserve(needed);
    const entityBuffer = this.#entityBuffer;
    const slotBuffer = this.#slotBuffer;
    if (bulk) {
      slotBuffer.set(slots, start);
      entityBuffer.set(handles, start);
    } else {
      for (let i = 0; i < count; i++) {
        slotBuffer[start + i] = slots[i]!;
        entityBuffer[start + i] = handles[i]!;
      }
    }
    this.count = start + count;
  }

  clear(): void {
    this.count = 0;
  }

  /** The packed handle buffer behind {@link entities}; only entries before {@link count} are valid. */
  get entityBuffer(): Uint32Array {
    return this.#entityBuffer;
  }

  /**
   * Zero-alloc dual walk: slot first (SoA), then packed handle (identity).
   */
  each(fn: BorrowedEntityListEachFn): void {
    const entities = this.#entityBuffer;
    const slots = this.#slotBuffer;
    const count = this.count;
    for (let i = 0; i < count; i++) {
      fn(slots[i]! as SlotIndex, entities[i]! as Entity, i);
    }
  }

  /**
   * Iterate the valid packed entity handles.
   *
   * Each call returns a fresh generator, so nested iteration of the same list is safe.
   */
  *[Symbol.iterator](): IterableIterator<Entity> {
    for (let i = 0; i < this.count; i++) {
      yield this.#entityBuffer[i]! as Entity;
    }
  }
}
