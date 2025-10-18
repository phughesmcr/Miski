import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { SchemaOrNull } from "../types.ts";
import type { QueryResultPool } from "./QueryPool.ts";

/** Cache for query results */
export class QueryCache {
  #componentCache: Map<string, Record<string, ComponentInstance<SchemaOrNull>>>;
  #entityCache: Map<string, BooleanArray>;
  #globalVersion: number;
  #pool?: QueryResultPool;

  constructor(pool?: QueryResultPool) {
    this.#componentCache = new Map();
    this.#entityCache = new Map();
    this.#globalVersion = 0;
    this.#pool = pool;
  }

  /** Get the current global version */
  get version(): number {
    return this.#globalVersion;
  }

  /** Increment global version to invalidate all caches */
  invalidate(): void {
    this.#globalVersion++;
  }

  /** Get cached components or compute and cache them */
  getComponents(
    queryId: string,
    compute: () => Record<string, ComponentInstance<SchemaOrNull<any>>>,
    lastVersion: number,
  ): Record<string, ComponentInstance<SchemaOrNull<any>>> {
    if (lastVersion < this.#globalVersion) {
      this.#componentCache.delete(queryId);
    }

    if (!this.#componentCache.has(queryId)) {
      this.#componentCache.set(queryId, compute());
    }

    return this.#componentCache.get(queryId)!;
  }

  /** Get cached entities or compute and cache them */
  getEntities(
    queryId: string,
    compute: () => BooleanArray,
    lastVersion: number,
  ): BooleanArray {
    if (lastVersion < this.#globalVersion) {
      // Release the old array back to the pool before removing
      const oldArray = this.#entityCache.get(queryId);
      if (oldArray && this.#pool) {
        this.#pool.releaseEntityArray(oldArray);
      }
      this.#entityCache.delete(queryId);
    }

    if (!this.#entityCache.has(queryId)) {
      this.#entityCache.set(queryId, compute());
    }

    return this.#entityCache.get(queryId)!;
  }

  /** Clear all caches and release pooled resources */
  clear(): void {
    // Release all entity arrays back to pool
    if (this.#pool) {
      for (const array of this.#entityCache.values()) {
        this.#pool.releaseEntityArray(array);
      }
    }
    this.#entityCache.clear();
    this.#componentCache.clear();
  }
}
