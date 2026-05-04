import { BooleanArray } from "@phughesmcr/booleanarray";
import { ReusableEntityIterator } from "../entity/EntityList.ts";
import type { Entity } from "../types.ts";

export class QueryEntityResult {
  #iterator: ReusableEntityIterator;
  count: number = 0;
  readonly indices: Uint32Array;

  constructor(size: number) {
    this.indices = new Uint32Array(size);
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
  #entityArrays: BooleanArray[] = [];
  #entityResults: QueryEntityResult[] = [];
  #size: number;

  constructor(size: number) {
    this.#size = size;
    this.#entityArrays = [];
    this.#entityResults = [];
  }

  acquireEntityArray(): BooleanArray {
    return this.#entityArrays.pop() ?? new BooleanArray(this.#size);
  }

  releaseEntityArray(array: BooleanArray): void {
    array.clear();
    this.#entityArrays.push(array);
  }

  acquireEntityResult(): QueryEntityResult {
    return this.#entityResults.pop() ?? new QueryEntityResult(this.#size);
  }

  releaseEntityResult(result: QueryEntityResult): void {
    result.clear();
    this.#entityResults.push(result);
  }
}
