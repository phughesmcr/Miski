import { Archetype } from "../archetype/archetype";
import { Component } from "../component/component";
import { ComponentInstance } from "../component/instance";
import { ComponentManager, ComponentRecord } from "../component/manager";
import { Entity } from "../entity";
import { createQueryInstance, QueryInstance } from "./instance";
import { Query } from "./query";

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

function refreshQuery(query: QueryInstance): QueryInstance {
  query.isDirty = false;
  return query;
}

export interface QueryManagerSpec {
  componentManager: ComponentManager;
}

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

  /** @todo creates new array & set every time - wasteful */
  /** @returns an array of Entities which have entered this query since last refresh */
  getEnteredFromQuery(query: Query): Entity[] {
    const instance = this.getQueryInstance(query);
    const res: Set<Entity> = new Set();
    instance.archetypes.forEach(_flattenEntered, res);
    return [...res];
  }

  /** @returns an array of Entities which match the query */
  getEntitiesFromQuery(query: Query, arr: Entity[] = []): Entity[] {
    arr.length = 0;

    const instance = this.getQueryInstance(query);

    const { archetypes, isDirty } = instance;

    const cached = this.entityCache.get(instance) as Set<Entity>;

    // if new query, do full sweep and create cache set
    if (!cached) {
      const res: Set<Entity> = new Set();
      archetypes.forEach(_flattenEntities, res);
      this.entityCache.set(instance, res);
      return arr.concat(...res);
    }

    // if query has new Archetypes, clear cache and do full sweep
    if (isDirty === true) {
      cached.clear();
      archetypes.forEach(_flattenEntities, cached);
      return arr.concat(...cached);
    }

    // else just update the dirty archetypes
    archetypes.forEach((archetype) => {
      if (archetype.isDirty === true) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        archetype.entered.forEach(cached.add, cached);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        archetype.exited.forEach(cached.delete, cached);
      }
    });

    return arr.concat(...cached);
  }

  /** @todo creates new array & set every time - wasteful */
  /** @returns an array of Entities which have been removed from this query since last refresh */
  getExitedFromQuery(query: Query): Entity[] {
    const instance = this.getQueryInstance(query);
    const res: Set<Entity> = new Set();
    instance.archetypes.forEach(_flattenExited, res);
    return [...res];
  }

  /** @returns an instantiated Query */
  getQueryInstance(query: Query): QueryInstance {
    return this.registerQuery(query);
  }

  /** Register a Query in the world, producing a QueryInstance */
  registerQuery(query: Query): QueryInstance {
    if (!(query instanceof Query)) throw new Error("Object is not a valid query.");
    const cached = this.queryMap.get(query);
    if (cached) return cached;
    const instance = createQueryInstance({ componentMap: this.componentMap, query });
    this.queryMap.set(query, instance);
    return instance;
  }

  /** Perform routine maintenance on each registered query */
  refreshQueries() {
    this.queryMap.forEach(refreshQuery);
  }
}
