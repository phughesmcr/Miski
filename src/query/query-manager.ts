/**
 * @name        QueryManager
 * @description Handles the creation, destruction of Queries
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { $dirty, Archetype } from "../archetype/archetype";
import { isValidName } from "../utils/strings";
import { World } from "../world";
import { createQuery, Query, QuerySpec } from "./query";

export type QueryRegistry = { [key: string]: Query };

export interface QueryManager {
  getQueries: () => Query[];
  isQueryRegistered: (query: Query) => boolean;
  registerQuery: (spec: QuerySpec) => Query;
  refreshQuery: (query: Query) => Query;
  refreshQueries: () => World;
  unregisterQuery: (query: Query) => World;
}

function _getQueries(registry: QueryRegistry) {
  /** @returns an array of all the queries in the world */
  function getQueries(): Query[] {
    return [...Object.values(registry)];
  }
  return getQueries;
}

function _isQueryRegistered(registry: QueryRegistry) {
  /**
   * Check if a query is registered in this world
   * @param query the query to check
   * @returns true if the given query is registered in this world
   */
  function isQueryRegistered(query: Query): boolean {
    return Boolean(query.name in registry);
  }
  return isQueryRegistered;
}

function _registerQuery(registry: QueryRegistry, world: World) {
  const _refresher = _refreshQuery(world);
  /**
   * Creates and registers a new query
   * @param spec the query specification
   * @returns the new query
   */
  function registerQuery(spec: QuerySpec): Query {
    if (!isValidName(spec.name)) {
      throw new Error("Invalid name provided for query.");
    }
    if (spec.name in registry) {
      throw new Error(`Query with name "${spec.name}" is already registered in this world.`);
    }
    const query = createQuery(world, spec);
    registry[query.name] = query;
    _refresher(query);
    return query;
  }
  return registerQuery;
}

function _refreshQuery(world: World) {
  /**
   * Manually force a query to refresh its archetype cache.
   * This is called automatically for all queries once per step()
   * in the post() function.
   * @param query the query to refresh
   * @returns the world
   */
  function refreshQuery(query: Query): Query {
    if (!("archetypes" in query)) {
      throw new TypeError("invalid query provided.");
    }
    world.getArchetypes().forEach((archetype: Archetype) => {
      if (archetype[$dirty] === true) {
        query.isMatch(archetype);
      }
    });
    return query;
  }
  return refreshQuery;
}

function _refreshQueries(registry: QueryRegistry, world: World) {
  const _refresher = _refreshQuery(world);
  /**
   * Manually force all queries to refresh their archetype cache.
   * This is called automatically once per step() in the post() function.
   * @returns the world
   */
  function refreshQueries(): World {
    Object.values(registry).forEach((query) => _refresher(query));
    world.getArchetypes().forEach((archetype: Archetype) => (archetype[$dirty] = false));
    return world;
  }
  return refreshQueries;
}

function _unregisterQuery(registry: QueryRegistry, world: World) {
  /**
   * Unregister a given query
   * @param query the query to unregister
   * @returns the world
   */
  function unregisterQuery(query: Query): World {
    delete registry[query.name];
    return world;
  }
  return unregisterQuery;
}

export function createQueryManager(world: World): QueryManager {
  const registry: QueryRegistry = {};

  return {
    getQueries: _getQueries(registry),
    isQueryRegistered: _isQueryRegistered(registry),
    registerQuery: _registerQuery(registry, world),
    refreshQuery: _refreshQuery(world),
    refreshQueries: _refreshQueries(registry, world),
    unregisterQuery: _unregisterQuery(registry, world),
  };
}
