import { createEntityArray, createSlotArray, type EntityArray } from "@/entity/entity.ts";
import { ReusableEntityIterator } from "@/entity/entity.ts";
import type {
  BorrowedEntityIndices,
  BorrowedEntityListEachFn,
  BorrowedSlotIndices,
  Entity,
  EntityResultSink,
  SlotIndex,
} from "@/entity/entity.ts";

/** Retained backing store for the public borrowed QueryEntityList view. */
export class QueryEntityResult implements EntityResultSink {
  #iterator: ReusableEntityIterator;
  #entityBuffer: Uint32Array;
  #slotBuffer: EntityArray;
  count: number = 0;
  /** Packed entity handles for identity. */
  readonly entities: BorrowedEntityIndices;
  /** Slot indices for SoA storage access. */
  readonly slots: BorrowedSlotIndices;

  constructor(size: number) {
    this.#entityBuffer = createEntityArray(size);
    this.#slotBuffer = createSlotArray(size);
    this.entities = this.#entityBuffer as unknown as BorrowedEntityIndices;
    this.slots = this.#slotBuffer as unknown as BorrowedSlotIndices;
    this.#iterator = new ReusableEntityIterator(this.#entityBuffer);
  }

  add(entity: Entity, slot: SlotIndex): void {
    this.#entityBuffer[this.count] = entity;
    this.#slotBuffer[this.count] = slot;
    this.count++;
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
