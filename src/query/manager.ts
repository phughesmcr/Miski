/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import type { Archetype } from "../archetype/archetype.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { ComponentManager, ComponentRecord } from "../component/manager.js";
import type { Entity } from "../world.js";
import type { QueryInstance } from "./instance.js";
import { createQueryInstance } from "./instance.js";
import { Query } from "./query.js";

/** @todo find a nicer way of doing this */
// NOTE: The following functions are used to avoid flatmap which incurs a GC penalty

function _flattenEntered(this: Set<Entity>, { entered }: Archetype) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  entered.forEach(this.add, this);
}

function _flattenEntities(this: Set<Entity>, { entities }: Archetype) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  entities.forEach(this.add, this);
}

function _flattenExited(this: Set<Entity>, { exited }: Archetype) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  exited.forEach(this.add, this);
}

function refreshQuery(query: QueryInstance) {
  query.isDirty = false;
}

export type QueryManagerSpec = {
  componentManager: ComponentManager;
};

export class QueryManager {
  /** The components, and their instances, of a given world */
  componentMap: Map<Component<any>, ComponentInstance<any>>;
  /** Cache for Entities which match each QueryInstance */
  entityCache: Map<QueryInstance, Set<Entity>>;
  /** Map of registered Queries and their instances */
  queryMap: Map<Query, QueryInstance>;

  /**
   * Creates a new QueryManager
   *
   * QueryManagers are responsible for:
   *  - registering and instantiating queries
   *  - getting components and entities from query instances
   *
   * @param spec the manager's specification object
   */
  constructor(spec: QueryManagerSpec) {
    const { componentManager } = spec;
    this.componentMap = componentManager.componentMap;
    this.entityCache = new Map();
    this.queryMap = new Map();
  }

  /** @returns the components associated with a query */
  getComponentsFromQuery(query: Query): ComponentRecord {
    return this.getQueryInstance(query).components;
  }

  /** @returns an array of Entities which have entered this query since last refresh */
  getEnteredFromQuery(query: Query): () => IterableIterator<Entity> {
    const res: Set<Entity> = new Set();
    const instance = this.getQueryInstance(query);
    return (): IterableIterator<Entity> => {
      res.clear();
      instance.archetypes.forEach(_flattenEntered, res);
      return res.values();
    };
  }

  /** @returns an array of Entities which match the query */
  getEntitiesFromQuery(query: Query): () => IterableIterator<Entity> {
    const instance = this.getQueryInstance(query);
    const cached = this.entityCache.get(instance) ?? this.entityCache.set(instance, new Set()).get(instance)!;
    return () => {
      const { archetypes, isDirty } = instance;
      if (isDirty === true || !cached.size) {
        // if query has new Archetypes, clear cache and do full sweep
        cached.clear();
        archetypes.forEach(_flattenEntities, cached);
      } else {
        // else just update the dirty archetypes
        for (const archetype of archetypes) {
          if (archetype.isDirty === true) {
            // eslint-disable-next-line @typescript-eslint/unbound-method
            archetype.entered.forEach(cached.add, cached);
            // eslint-disable-next-line @typescript-eslint/unbound-method
            archetype.exited.forEach(cached.delete, cached);
          }
        }
      }
      return cached.values();
    };
  }

  /**
   * @returns an array of Entities which have been removed from this query since last refresh
   * @throws {TypeError} if the object is not a valid Query
   */
  getExitedFromQuery(query: Query): () => IterableIterator<Entity> {
    const res: Set<Entity> = new Set();
    const instance = this.getQueryInstance(query);
    return (): IterableIterator<Entity> => {
      res.clear();
      instance.archetypes.forEach(_flattenExited, res);
      return res.values();
    };
  }

  /**
   * @returns an instantiated Query
   * @throws {TypeError} if the object is not a valid Query
   */
  getQueryInstance(query: Query): QueryInstance {
    return this.queryMap.get(query) ?? this.registerQuery(query);
  }

  /**
   * Register a Query in the world, producing a QueryInstance
   * @throws {TypeError} if the object is not a valid Query
   */
  registerQuery(query: Query): QueryInstance {
    if (!(query instanceof Query)) throw new TypeError("Object is not a valid query.");
    const cached = this.queryMap.get(query);
    if (cached) return cached;
    const instance = createQueryInstance({ componentMap: this.componentMap, query });
    this.queryMap.set(query, instance);
    return instance;
  }

  /** Perform routine maintenance on each registered query */
  refreshQueries(): QueryManager {
    this.queryMap.forEach(refreshQuery);
    return this;
  }

  export() {
    return {
      queries: [...this.queryMap.values()],
    };
  }
}
