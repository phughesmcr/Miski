/**
 * @module      QueryManager
 * @description The QueryManager is responsible for creating, registering, and destroying queries.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { $_ARCHETYPE_KEY } from "../constants.ts";
import { BooleanArray } from "@phughesmcr/booleanarray";
import { createQueryInstance, type Query } from "./Query.ts";
import { QueryCache } from "./QueryCache.ts";
import { QueryResultPool } from "./QueryPool.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { Entity, QueryInstance, SchemaOrNull } from "../types.ts";
import type { World } from "../world/World.ts";

function getComponentsFromQuery(this: QueryManager, query: Query): Record<string, ComponentInstance<SchemaOrNull>> {
  const instance = this.register(query);
  const queryId = instance.id;

  const result = this.cache.getComponents(
    queryId,
    () => instance.components,
    this.lastQueryUpdate.get(queryId) ?? 0,
  );

  return result;
}

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
        for (const entity of archetype.getEntities()) {
          if (this.visited.getBool(entity)) continue;
          result.setBool(entity, true);
          this.visited.setBool(entity, true);
        }
      }

      return result;
    },
    this.lastQueryUpdate.get(queryId) ?? 0,
  );

  this.visited.clear();

  return result.truthyIndices();
}

/** The QueryManager is responsible for creating, registering, and destroying queries. */
export class QueryManager {
  /** Cache for query results */
  readonly cache: QueryCache;

  /** Map of registered Queries and their last update timestamp for the cache */
  readonly lastQueryUpdate: Map<string, number>;

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
    this.cache = new QueryCache();
    this.lastQueryUpdate = new Map();
    this.pool = new QueryResultPool(capacity);
    this.instancesByID = new Map();
    this.idsByQuery = new Map();
    this.visited = new BooleanArray(capacity);

    this.components = getComponentsFromQuery.bind(this);

    this.entities = getEntitiesFromQuery.bind(this);

    // Setup the registrar
    this.register = function (this: QueryManager, query: Query): QueryInstance {
      // Check if we already have an ID for this query
      let queryId = this.idsByQuery.get(query);

      if (queryId && this.instancesByID.has(queryId)) {
        // Return existing instance if we have one
        return this.instancesByID.get(queryId)!;
      }

      // Create new instance
      const instance: QueryInstance = createQueryInstance(world, query);
      queryId = instance.id;

      // Store mappings
      this.idsByQuery.set(query, queryId);
      this.instancesByID.set(queryId, instance);

      // Get matching components and populate instance
      const matchingComponents = world.archetypes.queryComponents(query);
      if (matchingComponents) {
        // Add components to instance
        Object.assign(instance.components, matchingComponents);

        // Add matching archetypes
        const entities = world.archetypes.queryEntities(query);
        if (entities) {
          for (const entity of entities) {
            const archetypeId = world.archetypes.getEntityArchetype(entity);
            if (archetypeId) {
              const archetype = world.archetypes[$_ARCHETYPE_KEY](archetypeId);
              if (archetype) {
                instance.archetypes.add(archetype);
              }
            }
          }
        }
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
        this.lastQueryUpdate.set(queryId, Date.now());
      }
    } else {
      this.cache.invalidate();
    }
  };

  stringify = (): string => {
    return "";
  };
}
