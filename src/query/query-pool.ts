import { ReusableEntityIterator } from "@/entity/entity-list.ts";
import { createEntityArray, type EntityArray } from "@/entity/entity-array.ts";
import type { Entity } from "@/types.ts";

/** Mutable pooled backing store for the public borrowed QueryEntityList view. */
export class QueryEntityResult {
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
