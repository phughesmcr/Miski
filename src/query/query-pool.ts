import { createEntityArray, createSlotArray, type EntityArray } from "@/entity/entity.ts";
import { ReusableEntityIterator } from "@/entity/entity.ts";
import type { Entity, EntityResultSink, SlotIndex } from "@/entity/entity.ts";

/** Mutable pooled backing store for the public borrowed QueryEntityList view. */
export class QueryEntityResult implements EntityResultSink {
  #iterator: ReusableEntityIterator;
  count: number = 0;
  /** Packed entity handles for identity. */
  readonly entities: Uint32Array;
  /**
   * Slot indices for SoA storage access.
   * Alias kept as `indices` for hot-loop partition indexing.
   */
  readonly indices: EntityArray;

  constructor(size: number) {
    this.entities = createEntityArray(size);
    this.indices = createSlotArray(size);
    this.#iterator = new ReusableEntityIterator(this.entities);
  }

  add(entity: Entity, slot: SlotIndex): void {
    this.entities[this.count] = entity;
    this.indices[this.count] = slot;
    this.count++;
  }

  clear(): void {
    this.count = 0;
  }

  iterate(): IterableIterator<Entity> {
    return this.#iterator.reset(this.count);
  }

  /**
   * Iterate the valid packed entity handles.
   *
   * Unlike {@link QueryEntityResult.iterate}, each call returns a fresh
   * iterator, so nested iteration of the same list is safe.
   */
  *[Symbol.iterator](): IterableIterator<Entity> {
    for (let i = 0; i < this.count; i++) {
      yield this.entities[i]! as Entity;
    }
  }
}

/** Pool for reusing query result objects */
export class QueryResultPool {
  #entityResults: QueryEntityResult[] = [];
  #size: number;

  constructor(size: number) {
    this.#size = size;
    this.#entityResults = [];
  }

  acquireEntityResult(): QueryEntityResult {
    return this.#entityResults.pop() ?? new QueryEntityResult(this.#size);
  }

  releaseEntityResult(result: QueryEntityResult): void {
    result.clear();
    this.#entityResults.push(result);
  }
}
