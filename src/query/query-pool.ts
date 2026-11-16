import { createEntityArray, createSlotArray, type EntityArray } from "@/entity/entity.ts";
import { packEntity, ReusableEntityIterator } from "@/entity/entity.ts";
import type {
  BorrowedEntityIndices,
  BorrowedEntityListEachFn,
  BorrowedSlotIndices,
  Entity,
  EntityResultSink,
  SlotIndex,
} from "@/entity/entity.ts";

/** Initial buffer length; buffers double on demand up to the world capacity. */
const INITIAL_RESULT_LENGTH = 16;

/**
 * Retained backing store for the public borrowed QueryEntityList view.
 *
 * Buffers are sized by the largest result seen, not by world capacity: they start small and double on demand
 * (capped at capacity). Growing re-points {@link entities}, {@link slots} and the reusable iterator, so read
 * them from the result after each refill rather than holding on to an older reference.
 */
export class QueryEntityResult implements EntityResultSink {
  #iterator: ReusableEntityIterator;
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
    this.#entityBuffer = createEntityArray(capacity, length);
    this.#slotBuffer = createSlotArray(capacity, length);
    this.entities = this.#entityBuffer as unknown as BorrowedEntityIndices;
    this.slots = this.#slotBuffer as unknown as BorrowedSlotIndices;
    this.#iterator = new ReusableEntityIterator(this.#entityBuffer);
  }

  /** Grow both buffers so they can hold `length` entries, keeping the first {@link count}. */
  reserve(length: number): void {
    if (length <= this.#entityBuffer.length) return;
    let next = Math.max(this.#entityBuffer.length * 2, 1);
    while (next < length) next *= 2;
    next = Math.min(next, Math.max(this.#capacity, length));
    const entities = createEntityArray(this.#capacity, next);
    const slots = createSlotArray(this.#capacity, next);
    entities.set(this.#entityBuffer.subarray(0, this.count));
    slots.set(this.#slotBuffer.subarray(0, this.count));
    this.#entityBuffer = entities;
    this.#slotBuffer = slots;
    this.entities = entities as unknown as BorrowedEntityIndices;
    this.slots = slots as unknown as BorrowedSlotIndices;
    this.#iterator.indices = entities;
  }

  add(entity: Entity, slot: SlotIndex): void {
    const index = this.count;
    if (index === this.#entityBuffer.length) this.reserve(index + 1);
    this.#entityBuffer[index] = entity;
    this.#slotBuffer[index] = slot;
    this.count = index + 1;
  }

  /**
   * Append a dense slot list, packing each handle from the world's generation array in the same pass.
   * @param list - Dense slots, in iteration order
   * @param count - Number of leading entries of `list` to append
   * @param generations - Per-slot generations (see {@link packEntity})
   */
  appendSlots(list: EntityArray, count: number, generations: Uint32Array): void {
    const start = this.count;
    const end = start + count;
    if (end > this.#entityBuffer.length) this.reserve(end);
    const entities = this.#entityBuffer;
    const slots = this.#slotBuffer;
    for (let i = 0; i < count; i++) {
      const slot = list[i]!;
      slots[start + i] = slot;
      entities[start + i] = packEntity(slot, generations[slot]!);
    }
    this.count = end;
  }

  clear(): void {
    this.count = 0;
  }

  iterate(): IterableIterator<Entity> {
    return this.#iterator.reset(this.count);
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
   * Unlike {@link QueryEntityResult.iterate}, each call returns a fresh
   * iterator, so nested iteration of the same list is safe.
   */
  *[Symbol.iterator](): IterableIterator<Entity> {
    for (let i = 0; i < this.count; i++) {
      yield this.#entityBuffer[i]! as Entity;
    }
  }
}
