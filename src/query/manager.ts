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
}

export function createQueryManager(spec: QueryManagerSpec): QueryManager {
  const { bitfieldFactory, componentMap } = spec;

  const queryMap: Map<Query, QueryInstance> = new Map();

  /** @returns a tuple of Entities and Components which match the Query criteria */
  function getQueryResult(query: Query): [Entity[], ComponentRecord] {
    let instance = queryMap.get(query);
    if (!instance) {
      instance = createQueryInstance({ bitfieldFactory, componentMap, query });
      queryMap.set(query, instance);
    }
    return [instance.getEntities(), instance.getComponents()];
  }

  return {
    queryMap,
    getQueryResult,
  };
}
