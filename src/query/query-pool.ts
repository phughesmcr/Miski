import { BooleanArray } from "@/shared/deps.ts";

/**
 * Pool for reusing query result BooleanArrays to reduce allocations.
 */
export class QueryResultPool {
  #entityArrays: BooleanArray[] = [];
  #size: number;

  /**
   * Create a new pool.
   * @param size - The BooleanArray length to allocate for pooled arrays.
   */
  constructor(size: number) {
    this.#size = size;
    this.#entityArrays = [];
  }

  /** Acquire a cleared BooleanArray for entity results */
  acquireEntityArray(): BooleanArray {
    return this.#entityArrays.pop() ?? new BooleanArray(this.#size);
  }

  /** Return an array to the pool; it will be cleared and reused */
  releaseEntityArray(array: BooleanArray): void {
    array.clear();
    this.#entityArrays.push(array);
  }
}
