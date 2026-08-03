import type { DynamicComponentInstance } from "@/types/component.ts";
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
  #pool: QueryResultPool;

  constructor(pool: QueryResultPool) {
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

  /** Get cached components or store them on first access */
  ensureComponents(
    queryId: string,
    components: Record<string, DynamicComponentInstance>,
  ): Record<string, DynamicComponentInstance> {
    const cached = this.#componentCache.get(queryId);
    if (cached !== undefined) return cached;
    this.#componentCache.set(queryId, components);
    return components;
  }

  /**
   * Return a cached entity result when the global version still matches.
   * Callers must fill and {@link storeEntities} on a miss — no compute closure.
   */
  getCachedEntities(queryId: string): QueryEntityResult | undefined {
    const entry = this.#entityCache.get(queryId);
    if (entry && entry.version === this.#globalVersion) {
      return entry.result;
    }
    return undefined;
  }

  /**
   * Acquire a pooled entity result for a cache miss, releasing any stale entry.
   * After filling, call {@link storeEntities}.
   */
  acquireEntitiesForFill(queryId: string): QueryEntityResult {
    const entry = this.#entityCache.get(queryId);
    if (entry) {
      this.#pool.releaseEntityResult(entry.result);
    }
    const result = this.#pool.acquireEntityResult();
    result.clear();
    return result;
  }

  /** Store a filled entity result at the current global version. */
  storeEntities(queryId: string, result: QueryEntityResult): void {
    const entry = this.#entityCache.get(queryId);
    if (entry) {
      entry.result = result;
      entry.version = this.#globalVersion;
      return;
    }
    this.#entityCache.set(queryId, { result, version: this.#globalVersion });
  }

  /** Clear all caches and release pooled resources */
  clear(): void {
    for (const entry of this.#entityCache.values()) {
      this.#pool.releaseEntityResult(entry.result);
    }
    this.#entityCache.clear();
    this.#componentCache.clear();
  }
}
