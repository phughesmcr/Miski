/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Bitfield } from "../bitfield.js";
import { Component, ComponentRecord } from "../component/component.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import {
  createQueryInstance,
  QueryInstance,
  getEnteredFromQuery,
  getEntitiesFromQuery,
  getExitedFromQuery,
} from "./instance.js";
import { isValidQuery, Query } from "./query.js";

export interface QueryManagerSpec {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  createBitfieldFromIds: (components: ComponentInstance<unknown>[]) => Bitfield;
  isArchetypeCandidate: (query: QueryInstance) => (archetype: Archetype) => boolean;
}

export interface QueryManager {
  queryMap: Map<Query, QueryInstance>;
  /** Entities which have entered this query since last refresh */
  getQueryEntered: (query: Query) => Entity[];
  /** Entities which have exited this query since last refresh */
  getQueryExited: (query: Query) => Entity[];
  /** @returns a tuple of Entities and Components which match the Query criteria */
  getQueryResult: (query: Query) => [Entity[], ComponentRecord];
  /** Run Query maintenance */
  refreshQuery: (archetypes: Archetype[]) => (query: QueryInstance) => QueryInstance;
}

export function createQueryManager(spec: QueryManagerSpec): QueryManager {
  const { createBitfieldFromIds, componentMap, isArchetypeCandidate } = spec;

  /** */
  const queryMap: Map<Query, QueryInstance> = new Map();

  /** */
  function refreshQuery(archetypes: Archetype[]): (query: QueryInstance) => QueryInstance {
    return function (query: QueryInstance): QueryInstance {
      const isCandidate = isArchetypeCandidate(query);
      const candidates = archetypes.filter(isCandidate);
      const add = query.archetypes.add.bind(query.archetypes);
      [...candidates].forEach(add);
      return query;
    };
  }

  /** */
  function registerQuery(query: Query): QueryInstance {
    if (!isValidQuery(query)) throw new Error("Object is not a valid query.");
    const instance = createQueryInstance({ createBitfieldFromIds, componentMap, query });
    queryMap.set(query, instance);
    return instance;
  }

  /** @returns a tuple of Entities and Components which match the Query criteria */
  function getQueryResult(query: Query): [Entity[], ComponentRecord] {
    const instance = queryMap.get(query) ?? registerQuery(query);
    return [getEntitiesFromQuery(instance), instance.components];
  }

  /** Entities which have entered this query since last refresh */
  function getQueryEntered(query: Query): Entity[] {
    const instance = queryMap.get(query) ?? registerQuery(query);
    return getEnteredFromQuery(instance);
  }

  /** Entities which have exited this query since last refresh */
  function getQueryExited(query: Query): Entity[] {
    const instance = queryMap.get(query) ?? registerQuery(query);
    return getExitedFromQuery(instance);
  }

  return {
    queryMap,
    getQueryEntered,
    getQueryExited,
    getQueryResult,
    refreshQuery,
  };
}
