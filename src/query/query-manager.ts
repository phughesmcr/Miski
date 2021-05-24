// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { World } from "../world";
import { Query, QuerySpec } from './query';

export interface QueryManagerSpec {
  [key: string]: unknown;
}

export interface QueryManager {
  /** @returns true if the given query is registered in this world */
  isQueryRegistered: (query: Query) => boolean;
  /**
   * Creates and registers a new query
   * @returns the new query
   */
  registerQuery: (spec: QuerySpec) => Query;
  /**
   * Force queries to refresh their archetype cache.
   * You probably don't need to use this as this is called automatically once per step().
   */
  refreshQueries: () => World;
  /**
   * Unregisters a given query
   * @returns the world
   */
  unregisterQuery: (query: Query) => World;
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

function createRefreshQueries(registry: Set<Query>, world: World) {
  return function refreshQueries(): World {
    registry.forEach((query) => query.update());
    return world;
  };
}

function createUnregisterQuery(registry: Set<Query>, world: World) {
  return function unregisterQuery(query: Query): World {
    registry.delete(query);
    return world;
  };
}

export function createQueryManager(world: World, _spec: QueryManagerSpec): QueryManager {
  const registry: Set<Query> = new Set();

  return {
    isQueryRegistered: createIsQueryRegistered(registry),
    registerQuery: createRegisterQuery(registry, world),
    refreshQueries: createRefreshQueries(registry, world),
    unregisterQuery: createUnregisterQuery(registry, world),
  };
}
