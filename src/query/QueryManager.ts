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
  #componentCache = new WeakMap<Query, Record<string, ComponentInstance<SchemaOrNull<any>>>>();
  #entityCache = new WeakMap<Query, BooleanArray>();
  #timestamp = 0;

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
  #cache = new QueryCache();

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
  constructor(world: World) {
    this.#cache = new QueryCache();
    this.#lastQueryUpdate = new Map();
    this.#pool = new QueryResultPool(world.entities.capacity);

    this.registry = new Map();
    this.#visited = new BooleanArray(world.entities.capacity);

    // Setup the registrar
    this.register = (query: Query): QueryInstance => {
      if (this.registry.has(query)) {
        return this.registry.get(query)!;
      }
      const instance = createQueryInstance(world, query);
      this.registry.set(query, instance);
      return instance;
    };
  }

  #computeComponents(query: Query) {
    const archetypes = this.registry.get(query)!.archetypes;
    const result: Record<string, ComponentInstance<SchemaOrNull<any>>> = {};
    for (const archetype of archetypes) {
      for (const component of archetype.components) {
        result[component.name] = component;
      }
    }
    return result;
  }

  *components(query: Query): IterableIterator<[string, ComponentInstance<SchemaOrNull<any>>]> {
    const result = this.#cache.getComponents(
      query,
      () => this.#computeComponents(query),
      this.#lastQueryUpdate.get(query) ?? 0,
    );
    try {
      yield* Object.entries(result);
    } finally {
      this.#pool.releaseComponentMap(result);
    }
  }

  #computeEntities(query: Query): BooleanArray {
    this.#visited.clear();
    const archetypes = this.registry.get(query)!.archetypes;
    const result = this.#pool.acquireEntityArray();
    for (const archetype of archetypes) {
      for (const entity of archetype.getEntities()) {
        if (this.#visited.getBool(entity)) continue;
        result.setBool(entity, true);
        this.#visited.setBool(entity, true);
      }
    }
    return result;
  }

  *entities(query: Query): IterableIterator<Entity> {
    const entityArray = this.#cache.getEntities(
      query,
      () => this.#computeEntities(query),
      this.#lastQueryUpdate.get(query) ?? 0,
    );

    try {
      yield* entityArray.values();
    } finally {
      this.#pool.releaseEntityArray(entityArray);
    }
  }

  /** Mark query as dirty and invalidate caches */
  invalidate(query?: Query): void {
    if (query) {
      this.#lastQueryUpdate.set(query, Date.now());
    } else {
      this.#cache.invalidate();
    }
  }

  stringify(): string {
    return "";
  }
}
