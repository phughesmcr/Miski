// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { World } from "../world";
import { Query, QuerySpec } from './query';

export interface QueryManagerSpec {
  [key: string]: unknown;
}

export interface QueryManager {
  isQueryRegistered: (query: Query) => boolean;
  registerQuery: (spec: QuerySpec) => Query;
  unregisterQuery: (query: Query) => World;
  updateQueries: () => World;
}

function createIsQueryRegistered(registry: Set<Query>) {
  return function isQueryRegistered(query: Query): boolean {
    return registry.has(query);
  };
}

function createRegisterQuery(registry: Set<Query>, world: World) {
  return function registerQuery(spec: QuerySpec): Query {
    const query = new Query(world, spec);
    registry.add(query);
    return query;
  };
}

function createUnregisterQuery(registry: Set<Query>, world: World) {
  return function unregisterQuery(query: Query): World {
    registry.delete(query);
    return world;
  };
}

function createUpdateQueries(registry: Set<Query>, world: World) {
  return function updateQueries(): World {
    registry.forEach((query) => query.update());
    return world;
  };
}

export function createQueryManager(world: World, _spec: QueryManagerSpec): QueryManager {
  const registry: Set<Query> = new Set();

  return {
    isQueryRegistered: createIsQueryRegistered(registry),
    registerQuery: createRegisterQuery(registry, world),
    unregisterQuery: createUnregisterQuery(registry, world),
    updateQueries: createUpdateQueries(registry, world),
  };
}
