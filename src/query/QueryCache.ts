import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { SchemaOrNull } from "../types.ts";

/** Cache for query results */
export class QueryCache {
  #componentCache: Map<string, Record<string, ComponentInstance<SchemaOrNull>>>;
  #entityCache: Map<string, BooleanArray>;
  #timestamp: number;

  constructor() {
    this.#componentCache = new Map();
    this.#entityCache = new Map();
    this.#timestamp = 0;
  }

  /** Increment timestamp to invalidate all caches */
  invalidate(): void {
    this.#timestamp++;
  }

  /** Get cached components or compute and cache them */
  getComponents(
    queryId: string,
    compute: () => Record<string, ComponentInstance<SchemaOrNull<any>>>,
    lastUpdate: number,
  ): Record<string, ComponentInstance<SchemaOrNull<any>>> {
    if (lastUpdate < this.#timestamp) {
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
    lastUpdate: number,
  ): BooleanArray {
    if (lastUpdate < this.#timestamp) {
      this.#entityCache.delete(queryId);
    }

    if (!this.#entityCache.has(queryId)) {
      this.#entityCache.set(queryId, compute());
    }

    return this.#entityCache.get(queryId)!;
  }
}
