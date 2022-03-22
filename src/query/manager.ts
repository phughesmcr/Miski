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

function flattenEntities(this: Entity[], { entities }: Archetype) {
  this.push(...entities);
}

/**
 *
 * @param query
 * @returns
 * @todo cache entities per archetype and add a dirty flag to archetypes - only update entities from dirty archetypes
 */
export function getEntitiesFromQuery(query: QueryInstance, cache: Map<QueryInstance, Set<Entity>>): Entity[] {
  const { archetypes } = query;

  // if new query, do full sweep and create cache set
  if (!cache.has(query)) {
    const res: Entity[] = [];
    archetypes.forEach(flattenEntities, res);
    cache.set(query, new Set(res));
    return res;
  }

  const cached = cache.get(query) as Set<Entity>;
  const adder = (e: Entity) => cached.add(e);
  const remover = (e: Entity) => cached.delete(e);

  // if query has new Archetypes, do full sweep
  if (query.isDirty) {
    const res: Entity[] = [];
    archetypes.forEach(flattenEntities, res);
    res.forEach(adder);
    return res;
  }

  // else just update the dirty archetypes
  archetypes.forEach((archetype) => {
    archetype.entered.forEach(adder);
    archetype.exited.forEach(remover);
  });

  return [...cached];
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
    return [instance.components, () => getEntitiesFromQuery(instance, entityCache)];
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
