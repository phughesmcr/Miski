import { ReusableEntityIterator } from "@/entity/entity.ts";
import { createEntityArray, type EntityArray } from "@/entity/entity.ts";
import type { Entity } from "@/entity/entity.ts";
import type { EntityResultSink } from "@/entity/entity.ts";

/** Mutable pooled backing store for the public borrowed QueryEntityList view. */
export class QueryEntityResult implements EntityResultSink {
  #iterator: ReusableEntityIterator;
  count: number = 0;
  readonly indices: EntityArray;

  constructor(size: number) {
    this.indices = createEntityArray(size);
    this.#iterator = new ReusableEntityIterator(this.indices);
  }

  add(entity: Entity): void {
    this.indices[this.count++] = entity;
  }

  clear(): void {
    this.count = 0;
  }

  iterate(): IterableIterator<Entity> {
    return this.#iterator.reset(this.count);
  }

  /**
   * Iterate the valid entity IDs.
   *
   * Unlike {@link QueryEntityResult.iterate}, each call returns a fresh
   * iterator, so nested iteration of the same list is safe.
   */
  *[Symbol.iterator](): IterableIterator<Entity> {
    for (let i = 0; i < this.count; i++) {
      yield this.indices[i]!;
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
