/**
 * @module      QueryManager
 * @description The QueryManager is responsible for creating, registering, and destroying queries.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "../constants.ts";
import { QueryCache } from "./QueryCache.ts";
import { QueryResultPool } from "./QueryPool.ts";
import type { Archetype } from "../archetype/Archetype.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { ComponentInstanceGetter, Entity, QueryInstance, SchemaOrNull } from "../types.ts";
import { NotRegisteredError } from "../errors.ts";
import type { Query } from "./Query.ts";
import type { World } from "../world/World.ts";

/**
 * @internal
 * Get components for a query
 * @param query - The Query to get components for
 * @returns A record of components
 */
function getComponentsFromQuery(this: QueryManager, query: Query): Record<string, ComponentInstance<SchemaOrNull>> {
  const instance = this.register(query);
  const queryId = instance.id;
  const result = this.cache.getComponents(
    queryId,
    () => instance.components,
    this.lastQueryVersion.get(queryId) ?? 0,
  );
  // Update last seen version after computing
  this.lastQueryVersion.set(queryId, this.cache.version);
  return result;
}

/**
 * @internal
 * Get entities for a query
 * @param query - The Query to get entities for
 * @returns An iterable iterator of entities
 */
function getEntitiesFromQuery(this: QueryManager, query: Query): IterableIterator<Entity> {
  const instance = this.register(query);
  const queryId = instance.id;

  const result = this.cache.getEntities(
    queryId,
    () => {
      this.visited.clear();
      const result = this.pool.acquireEntityArray();
      result.clear();
      for (const archetype of instance.archetypes) {
        archetype.writeEntitiesInto(result, this.visited);
      }
      this.visited.clear();
      return result;
    },
    this.lastQueryVersion.get(queryId) ?? 0,
  );

  // Update last seen version after computing
  this.lastQueryVersion.set(queryId, this.cache.version);

  return result.truthyIndices();
}

/**
 * @internal
 * Creates a runtime instance of a Query for efficient entity matching
 * @param getInstances - The function to get instances for an array of components
 * @param size - The size of the query
 * @param query - The Query definition specifying component requirements
 * @returns A QueryInstance.
 */
function createQueryInstance(getInstances: ComponentInstanceGetter, size: number, query: Query): QueryInstance {
  const getRegisteredInstances = (
    components: ReadonlyArray<Parameters<ComponentInstanceGetter>[0][number]>,
  ): ComponentInstance<SchemaOrNull<any>>[] => {
    const instances = getInstances(components);
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      if (!instance) {
        const component = components[i];
        throw new NotRegisteredError(`Component "${component?.name ?? "unknown"}" not registered in world.`);
      }
    }
    return instances as ComponentInstance<SchemaOrNull<any>>[];
  };

  // Create AND bit array - marks required components
  const andInstances = getRegisteredInstances(query.all);
  const and = new BooleanArray(size).setFromObjects(ID_KEY, andInstances, true);

  // Create OR bit array - marks optional components (need at least one)
  const orInstances = getRegisteredInstances(query.any);
  const or = new BooleanArray(size).setFromObjects(ID_KEY, orInstances, true);

  // Create NOT bit array - marks forbidden components
  const notInstances = getRegisteredInstances(query.none);
  const not = new BooleanArray(size).setFromObjects(ID_KEY, notInstances, true);

  // Build lookup table for quick component access
  const components: Record<string, ComponentInstance<SchemaOrNull<any>>> = {};
  for (const instance of [...andInstances, ...orInstances]) {
    components[instance.name] = instance;
  }
  Object.freeze(components);

  // Initialize empty set for matching archetypes
  const archetypes = new Set<Archetype>();

  // turn the three arrays into a string
  const id = `${and.toString()}:${or.toString()}:${not.toString()}`;

  return { and, or, not, archetypes, components, isDirty: true, id };
}

/** The QueryManager is responsible for creating, registering, and destroying queries. */
export class QueryManager {
  /** Cache for query results */
  readonly cache: QueryCache;

  /** Map of registered Queries and their last update version for the cache */
  readonly lastQueryVersion: Map<string, number>;

  /** Pool for reusing query result objects */
  readonly pool: QueryResultPool;

  /** Map of query IDs to their instances */
  readonly instancesByID: Map<string, QueryInstance>;

  /** Map of Query objects to their IDs */
  readonly idsByQuery: Map<Query, string>;

  /** Boolean array for visited entities */
  readonly visited: BooleanArray;

  /**
   * Create a new QueryManager
   * @param world - The World instance containing the component registry
   */
  constructor(world: World, capacity: number) {
    this.pool = new QueryResultPool(capacity);
    this.cache = new QueryCache(this.pool);
    this.lastQueryVersion = new Map();
    this.instancesByID = new Map();
    this.idsByQuery = new Map();
    this.visited = new BooleanArray(capacity);

    this.components = getComponentsFromQuery.bind(this);

    this.entities = getEntitiesFromQuery.bind(this);

    // Setup the registrar
    this.register = function (this: QueryManager, query: Query): QueryInstance {
      // Check if we already have an ID for this query
      let queryId = this.idsByQuery.get(query);

      // Return existing instance if we have one
      if (queryId && this.instancesByID.has(queryId)) {
        return this.instancesByID.get(queryId)!;
      }

      // Create new instance
      const instance: QueryInstance = createQueryInstance(
        world.components.getInstances,
        world.components.count,
        query,
      );
      queryId = instance.id;

      // Store mappings
      this.idsByQuery.set(query, queryId);
      this.instancesByID.set(queryId, instance);

      // Refresh archetypes after query registration to update mappings
      if (world.state === "initialized") {
        world.refresh(true, true);
      }

      return instance;
    }.bind(this);
  }

  /** Get components for a query */
  components: (query: Query) => Record<string, ComponentInstance<SchemaOrNull>>;

  /** Get entities for a query */
  entities: (query: Query) => IterableIterator<Entity>;

  /** Register a query */
  register: (query: Query) => QueryInstance;

  /** Mark query as dirty and invalidate caches */
  invalidate = (query?: Query): void => {
    if (query) {
      const queryId = this.idsByQuery.get(query);
      if (queryId) {
        this.lastQueryVersion.set(queryId, this.cache.version);
      }
    } else {
      this.cache.invalidate();
    }
  };
}
