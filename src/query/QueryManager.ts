/**
 * @module      QueryManager
 * @description The QueryManager is responsible for creating, registering, and destroying queries.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { createQueryInstance, type Query } from "./Query.ts";
import type { Entity, QueryInstance, SchemaOrNull } from "../types.ts";
import type { World } from "../world/World.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import { BooleanArray } from "@phughesmcr/booleanarray";

/** Cache for query results */
class QueryCache {
  #componentCache: WeakMap<Query, Record<string, ComponentInstance<SchemaOrNull>>>;
  #entityCache: WeakMap<Query, BooleanArray>;
  #timestamp: number;

  constructor() {
    this.#componentCache = new WeakMap();
    this.#entityCache = new WeakMap();
    this.#timestamp = 0;
  }

  /** Increment timestamp to invalidate all caches */
  invalidate(): void {
    this.#timestamp++;
  }

  /** Get cached components or compute and cache them */
  getComponents(
    query: Query,
    compute: () => Record<string, ComponentInstance<SchemaOrNull<any>>>,
    lastUpdate: number,
  ): Record<string, ComponentInstance<SchemaOrNull<any>>> {
    if (lastUpdate < this.#timestamp) {
      this.#componentCache.delete(query);
    }

    if (!this.#componentCache.has(query)) {
      this.#componentCache.set(query, compute());
    }

    return this.#componentCache.get(query)!;
  }

  /** Get cached entities or compute and cache them */
  getEntities(
    query: Query,
    compute: () => BooleanArray,
    lastUpdate: number,
  ): BooleanArray {
    if (lastUpdate < this.#timestamp) {
      this.#entityCache.delete(query);
    }

    if (!this.#entityCache.has(query)) {
      this.#entityCache.set(query, compute());
    }

    return this.#entityCache.get(query)!;
  }
}

/** Pool for reusing query result objects */
class QueryResultPool {
  #entityArrays: BooleanArray[] = [];
  #componentMaps: Record<string, ComponentInstance<SchemaOrNull<any>>>[] = [];
  #size: number;

  constructor(size: number) {
    this.#size = size;
    this.#entityArrays = [];
    this.#componentMaps = [];
  }

  acquireEntityArray(): BooleanArray {
    return this.#entityArrays.pop() ?? new BooleanArray(this.#size);
  }

  releaseEntityArray(array: BooleanArray): void {
    array.clear();
    this.#entityArrays.push(array);
  }

  acquireComponentMap(): Record<string, ComponentInstance<SchemaOrNull<any>>> {
    return this.#componentMaps.pop() ?? {};
  }

  releaseComponentMap(map: Record<string, ComponentInstance<SchemaOrNull<any>>>): void {
    Object.keys(map).forEach((key) => delete map[key]);
    this.#componentMaps.push(map);
  }
}

/** The QueryManager is responsible for creating, registering, and destroying queries. */
export class QueryManager {
  /** Cache for query results */
  #cache: QueryCache;

  /** Map of registered Queries and their last update timestamp for the cache */
  #lastQueryUpdate: Map<Query, number>;

  /** Pool for reusing query result objects */
  #pool: QueryResultPool;

  /** Map of registered Queries and their instances */
  registry: Map<Query, QueryInstance>;

  /** Registers a query */
  register: (query: Query) => QueryInstance;

  /** Boolean array for visited entities */
  #visited: BooleanArray;

  /**
   * Create a new QueryManager
   * @param world - The World instance containing the component registry
   */
  constructor(world: World, capacity: number) {
    this.#cache = new QueryCache();
    this.#lastQueryUpdate = new Map();
    this.#pool = new QueryResultPool(capacity);

    this.registry = new Map();
    this.#visited = new BooleanArray(capacity);

    // Setup the registrar
    this.register = (query: Query): QueryInstance => {
      if (this.registry.has(query)) {
        return this.registry.get(query)!;
      }
      const instance = createQueryInstance(world, query);
      this.registry.set(query, instance);
      return instance;
    };

    this.components = (query: Query): IterableIterator<[string, ComponentInstance<SchemaOrNull>]> => {
      const result = this.#cache.getComponents(
        query,
        () => {
          const instance = createQueryInstance(world, query);
          return instance.components;
        },
        this.#lastQueryUpdate.get(query) ?? 0,
      );

      const entries = Object.entries(result);
      const cleanup = () => this.#pool.releaseComponentMap(result);
      let i = 0;

      return {
        [Symbol.iterator]() {
          return this;
        },
        next: () => {
          const result = entries[i++];
          if (result === undefined) {
            cleanup();
            return { done: true as const, value: undefined };
          }
          return { done: false as const, value: result };
        },
      };
    };

    this.entities = (query: Query): IterableIterator<Entity> => {
      const entityArray = this.#cache.getEntities(
        query,
        () => {
          const instance = createQueryInstance(world, query);
          this.#visited.clear();
          const result = this.#pool.acquireEntityArray();
          for (const archetype of instance.archetypes) {
            for (const entity of archetype.getEntities()) {
              if (this.#visited.getBool(entity)) continue;
              result.setBool(entity, true);
              this.#visited.setBool(entity, true);
            }
          }
          return result;
        },
        this.#lastQueryUpdate.get(query) ?? 0,
      );

      const iterator = entityArray.truthyIndices();
      const cleanup = () => this.#pool.releaseEntityArray(entityArray);

      return {
        [Symbol.iterator]() {
          return this;
        },
        next: () => {
          const result = iterator.next();
          if (result.done) {
            cleanup();
            return { done: true as const, value: undefined };
          }
          return { done: false as const, value: result.value };
        },
      };
    };
  }

  /** Get components for a query */
  components: (query: Query) => IterableIterator<[string, ComponentInstance<SchemaOrNull>]>;

  /** Get entities for a query */
  entities: (query: Query) => IterableIterator<Entity>;

  /** Mark query as dirty and invalidate caches */
  invalidate = (query?: Query): void => {
    if (query) {
      this.#lastQueryUpdate.set(query, Date.now());
    } else {
      this.#cache.invalidate();
    }
  };

  stringify = (): string => {
    return "";
  };
}
