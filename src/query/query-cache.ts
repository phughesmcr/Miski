import type { DynamicComponentInstance } from "@/types.ts";
import type { QueryEntityResult, QueryResultPool } from "./query-pool.ts";

/** Cache for query results */
export class QueryCache {
  #componentCache: Map<string, Record<string, DynamicComponentInstance>>;
  #entityCache: Map<string, QueryEntityResult>;
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
    compute: () => Record<string, DynamicComponentInstance>,
    lastVersion: number,
  ): Record<string, DynamicComponentInstance> {
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
    compute: () => QueryEntityResult,
    lastVersion: number,
  ): QueryEntityResult {
    if (lastVersion < this.#globalVersion) {
      // Release the old array back to the pool before removing
      const oldResult = this.#entityCache.get(queryId);
      if (oldResult && this.#pool) {
        this.#pool.releaseEntityResult(oldResult);
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
      for (const result of this.#entityCache.values()) {
        this.#pool.releaseEntityResult(result);
      }
    }
    this.#entityCache.clear();
    this.#componentCache.clear();
  }
}
