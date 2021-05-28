// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from "../component/component";
import { Entity } from "../entity/entity";
import { World } from "../world";

export type Query = [all: bigint, any: bigint, none: bigint];

export type QueryRegistry = Map<Query, Set<Entity>>;

export interface QuerySpec {
  /** Gather entities as long as they have all these components */
  all?: Component<unknown>[],
  /** Gather entities as long as they have 0...* of these components */
  any?: Component<unknown>[],
  /** Gather entities as long as they don't have these components */
  none?: Component<unknown>[],
}

export interface QueryManagerSpec {
  [key: string]: unknown;
}

export interface QueryManager {
  getEntitiesFromQuery: (query: Query) => Entity[];
  isQueryRegistered: (query: Query) => boolean;
  registerQuery: (spec: QuerySpec) => Query;
  refreshQueries: () => World;
  unregisterQuery: (query: Query) => World;
}

function archetypeFromComponents(world: World, components: Component<unknown>[]): bigint {
  const ids: bigint[] = components.map((component) => world.getComponentId(component)).filter(Boolean) as bigint[];
  return ids.reduce((mask, id) => {
    mask |= (1n << id);
    return mask;
  }, 0n);
}

function isArchetypeQueryCandidate(query: Query, archetype: bigint): boolean {
  const [all = 0n, any = 0n, none = 0n] = query;
  const _all = (archetype & all) === all;
  const _any = any === 0n || (archetype & any) > 0;
  const _none = (archetype & none) === 0n;
  return _any && _all && _none;
}

function createQuery(world: World, spec: QuerySpec): Query {
  const {
    all = [],
    any = [],
    none = [],
  } = spec;

  return [
    archetypeFromComponents(world, all),
    archetypeFromComponents(world, any),
    archetypeFromComponents(world, none),
  ];
}

function createGetEntitiesFromQuery(registry: QueryRegistry) {
  /**
   * Get all the entities matching a given query
   * @param query the query to match
   * @returns an Entity array
   */
  function getEntitiesFromQuery(query: Query): Entity[] {
    return [...registry.get(query) ?? []];
  }
  return getEntitiesFromQuery;
}

function createIsQueryRegistered(registry: QueryRegistry) {
  /**
   * Check if a query is registered in this world
   * @param query the query to check
   * @returns true if the given query is registered in this world
   */
  function isQueryRegistered(query: Query): boolean {
    return registry.has(query);
  }
  return isQueryRegistered;
}

function createRegisterQuery(registry: QueryRegistry, world: World) {
  /**
   * Creates and registers a new query
   * @param spec the query specification
   * @returns the new query
   */
  function registerQuery(spec: QuerySpec): Query {
    const query = createQuery(world, spec);
    const entities = world.getEntitiesFromQuery(query);
    registry.set(query, new Set(entities));
    return query;
  }
  return registerQuery;
}

function createRefreshQueries(registry: QueryRegistry, world: World) {
  /**
   * @danger
   * Force queries to refresh their archetype cache.
   * You probably don't need to use this as this is
   * called automatically once per step().
   * @returns the world
   */
  function refreshQueries(): World {
    world.getDirtyArchetypes().forEach(([archetype, candidates]) => {
      registry.forEach((entities, query) => {
        if (isArchetypeQueryCandidate(query, archetype) === true) {
          entities.clear();
          candidates.forEach((candidate) => entities.add(candidate));
        }
      });
    });
    return world;
  }
  return refreshQueries;
}

function createUnregisterQuery(registry: QueryRegistry, world: World) {
  /**
   * Unregister a given query
   * @param query the query to unregister
   * @returns the world
   */
  function unregisterQuery(query: Query): World {
    registry.delete(query);
    return world;
  }
  return unregisterQuery;
}

/**
 * Creates a new query manager object
 * @param world the world associated with this manager
 * @param _spec the query manager specification
 * @returns the created query manager
 */
export function createQueryManager(world: World, _spec: QueryManagerSpec): QueryManager {
  const registry: QueryRegistry = new Map();

  return {
    getEntitiesFromQuery: createGetEntitiesFromQuery(registry),
    isQueryRegistered: createIsQueryRegistered(registry),
    registerQuery: createRegisterQuery(registry, world),
    refreshQueries: createRefreshQueries(registry, world),
    unregisterQuery: createUnregisterQuery(registry, world),
  };
}
