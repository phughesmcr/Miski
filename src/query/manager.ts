/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../bitfield.js";
import { Component } from "../component/component.js";
import { ComponentRecord } from "../component/manager.js";
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

export function createQueryManager(spec: QueryManagerSpec): QueryManager {
  const { createBitfieldFromIds, componentMap } = spec;

  /** Map of registered Queries and their instances */
  const queryMap: Map<Query, QueryInstance> = new Map();

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
    return [instance.components, () => getEntitiesFromQuery(instance)];
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
