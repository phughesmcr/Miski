import type { DynamicComponentInstance } from "@/types.ts";
import type { QueryEntityResult, QueryResultPool } from "./query-pool.ts";

type EntityCacheEntry = {
  result: QueryEntityResult;
  version: number;
};

/** Cache for query results */
export class QueryCache {
  #componentCache: Map<string, Record<string, DynamicComponentInstance>>;
  #entityCache: Map<string, EntityCacheEntry>;
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
  ): Record<string, DynamicComponentInstance> {
    if (!this.#componentCache.has(queryId)) {
      this.#componentCache.set(queryId, compute());
    }

    return this.#componentCache.get(queryId)!;
  }

  /** Get cached entities or compute and cache them */
  getEntities(
    queryId: string,
    compute: () => QueryEntityResult,
  ): QueryEntityResult {
    const entry = this.#entityCache.get(queryId);
    if (entry && entry.version === this.#globalVersion) {
      return entry.result;
    }

    if (entry && this.#pool) {
      this.#pool.releaseEntityResult(entry.result);
      this.#entityCache.delete(queryId);
    }

    const result = compute();
    this.#entityCache.set(queryId, { result, version: this.#globalVersion });
    return result;
  }

  /** Clear all caches and release pooled resources */
  clear(): void {
    // Release all entity arrays back to pool
    if (this.#pool) {
      for (const entry of this.#entityCache.values()) {
        this.#pool.releaseEntityResult(entry.result);
      }
    }
    this.#entityCache.clear();
    this.#componentCache.clear();
  }
}
