/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield, Component, ComponentInstance, ComponentRecord, Query, QueryInstance } from "..";
import { Entity } from "../entity";
import { createQueryInstance } from "./instance";

export interface QueryManagerSpec {
  bitfieldFactory: () => Bitfield;
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
}

export interface QueryManager {
  queryMap: Map<Query, QueryInstance>;
  /** @returns a tuple of Entities and Components which match the Query criteria */
  getQueryResult: (query: Query) => [Entity[], ComponentRecord];
  /** Entities which have entered this query since last refresh */
  getQueryEntered: (query: Query) => [Entity[], ComponentRecord];
  /** Entities which have exited this query since last refresh */
  getQueryExited: (query: Query) => [Entity[], ComponentRecord];
}

export function createQueryManager(spec: QueryManagerSpec): QueryManager {
  const { bitfieldFactory, componentMap } = spec;

  const queryMap: Map<Query, QueryInstance> = new Map();

  const register = (query: Query) => {
    const instance = createQueryInstance({ bitfieldFactory, componentMap, query });
    queryMap.set(query, instance);
    return instance;
  };

  /** @returns a tuple of Entities and Components which match the Query criteria */
  function getQueryResult(query: Query): [Entity[], ComponentRecord] {
    const instance = queryMap.get(query) ?? register(query);
    return [instance.getEntities(), instance.getComponents()];
  }

  /** Entities which have entered this query since last refresh */
  function getQueryEntered(query: Query): [Entity[], ComponentRecord] {
    const instance = queryMap.get(query) ?? register(query);
    return [instance.getEntered(), instance.getComponents()];
  }

  /** Entities which have exited this query since last refresh */
  function getQueryExited(query: Query): [Entity[], ComponentRecord] {
    const instance = queryMap.get(query) ?? register(query);
    return [instance.getExited(), instance.getComponents()];
  }

  return {
    queryMap,
    getQueryResult,
    getQueryEntered,
    getQueryExited,
  };
}
