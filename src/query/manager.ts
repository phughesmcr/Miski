/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import type { Bitfield } from "../bitfield.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { ComponentRecord } from "../component/manager.js";
import type { Entity } from "../entity.js";
import { createQueryInstance, QueryInstance } from "./instance.js";
import { isValidQuery, Query } from "./query.js";

interface QueryManagerSpec {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  createBitfieldFromIds: (components: ComponentInstance<unknown>[]) => Bitfield;
}

export interface QueryManager {
  queryMap: Map<Query, QueryInstance>;
  /** Entities which have entered this query since last refresh */
  getQueryEntered: (query: Query) => Entity[];
  /** Entities which have exited this query since last refresh */
  getQueryExited: (query: Query) => Entity[];
  /** @returns a tuple of Components and Entities which match the Query criteria */
  getQueryResult: (query: Query) => [ComponentRecord, () => Entity[]];
}

function flattenEntities(this: Set<Entity>, { entities }: Archetype) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  entities.forEach(this.add, this);
}

/**
 *
 * @param query
 * @returns
 * @todo cache entities per archetype and add a dirty flag to archetypes - only update entities from dirty archetypes
 */
export function getEntitiesFromQuery(query: QueryInstance, cache: Map<QueryInstance, Set<Entity>>): Set<Entity> {
  const { archetypes } = query;

  const cached = cache.get(query) as Set<Entity>;

  // if new query, do full sweep and create cache set
  if (!cached) {
    const res: Set<Entity> = new Set();
    archetypes.forEach(flattenEntities, res);
    cache.set(query, res);
    return res;
  }

  // if query has new Archetypes, do full sweep
  if (query.isDirty === true) {
    cached.clear();
    archetypes.forEach(flattenEntities, cached);
    return cached;
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

  return cached;
}

/**
 *
 * @param query
 * @returns
 */
export function getEnteredFromQuery(query: QueryInstance): Entity[] {
  return [...query.archetypes].flatMap((archetype) => [...archetype.entered]);
}

/**
 *
 * @param query
 * @returns
 */
export function getExitedFromQuery(query: QueryInstance): Entity[] {
  return [...query.archetypes].flatMap((archetype) => [...archetype.exited]);
}

export function createQueryManager(spec: QueryManagerSpec): QueryManager {
  const { createBitfieldFromIds, componentMap } = spec;

  /** Map of registered Queries and their instances */
  const queryMap: Map<Query, QueryInstance> = new Map();

  const entityCache: Map<QueryInstance, Set<Entity>> = new Map();

  /** Register a Query in the world, producing a QueryInstance */
  const registerQuery = (query: Query): QueryInstance => {
    if (!isValidQuery(query)) throw new Error("Object is not a valid query.");
    const instance = createQueryInstance({ createBitfieldFromIds, componentMap, query });
    queryMap.set(query, instance);
    return instance;
  };

  /** @private utility function to get QueryInstance from Query in the world */
  const _getQueryInstance = (query: Query): QueryInstance => queryMap.get(query) ?? registerQuery(query);

  /** @returns a tuple of Entities and Components which match the Query criteria */
  const getQueryResult = (query: Query): [ComponentRecord, () => Entity[]] => {
    const instance = _getQueryInstance(query);
    return [instance.components, () => [...getEntitiesFromQuery(instance, entityCache)]];
  };

  /** Entities which have entered this query since last refresh */
  const getQueryEntered = (query: Query): Entity[] => getEnteredFromQuery(_getQueryInstance(query));

  /** Entities which have exited this query since last refresh */
  const getQueryExited = (query: Query): Entity[] => getExitedFromQuery(_getQueryInstance(query));

  return {
    queryMap,
    getQueryEntered,
    getQueryExited,
    getQueryResult,
  };
}
