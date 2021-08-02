"use strict";

import { Archetype } from "./archetype.js";
import { Component, ComponentInstance, createBitmaskFromComponents } from "./component.js";
import { Entity } from "./entity.js";
import { Bitmask } from "./mask.js";
import { indexOf, spliceOne } from "./utils.js";
import { World } from "./world.js";

export interface QuerySpec {
  /** AND - Gather entities as long as they have all these components */
  all?: Component<unknown>[];
  /** OR - Gather entities as long as they have 0...* of these components */
  any?: Component<unknown>[];
  /** NOT - Gather entities as long as they don't have these components */
  none?: Component<unknown>[];
}

export interface Query extends Required<QuerySpec> {
  /** Instances of this query registered in a world/system */
  instances: QueryInstance[];
}

/** Queries are groupings of archetypes */
export interface QueryInstance {
  /** The archetypes which match this query */
  archetypes: Archetype[];
  /** A bitmask for the AND match criteria */
  and: Bitmask;
  /** A bitmask for the OR match criteria */
  or: Bitmask;
  /** A bitmask for the NOT match criteria */
  not: Bitmask;
  /** The world associated with this instance */
  world: World;
}

/**
 * Create a new query
 * @param spec the query specification
 * @returns the created query object
 */
export function createQuery(spec: QuerySpec): Query {
  if (!spec) throw new Error("Query spec object required.");
  const { all = [], any = [], none = [] } = spec;
  // @todo validate arrays contain only components
  return {
    instances: [],
    all: [...all],
    any: [...any],
    none: [...none],
  };
}

/**
 * Test if an archetype matches a query's criteria
 * @param query the query to test the archetype against
 * @param archetype the archetype to test
 * @returns true if the archetype is a match
 */
export function isQueryCandidate(query: QueryInstance, archetype: Archetype): boolean {
  for (let i = 0, length = query.and.length; i < length; i++) {
    const _target = archetype.mask[i];
    if ((query.not[i] & _target) !== 0) return false;
    if ((query.and[i] & _target) !== query.and[i]) return false;
    if ((query.or[i] & _target) > 0) return false;
  }
  return true;
}

/** Add an archetype to a query instance */
export function addArchetypeToQuery(query: QueryInstance, archetype: Archetype): QueryInstance {
  if (query.archetypes.indexOf(archetype) !== -1) return query;
  query.archetypes.push(archetype);
  return query;
}

/** Remove an archetype from a query instance */
export function removeArchetypeFromQuery(query: QueryInstance, archetype: Archetype): QueryInstance {
  const idx = query.archetypes.indexOf(archetype);
  if (idx === -1) return query;
  spliceOne(query.archetypes, idx);
  return query;
}

/** helper function for flat-mapping archetype components */
function _getComponents(archetype: Archetype): ComponentInstance<unknown>[] {
  return [...archetype.components];
}

/** Get an object of components by name */
export function getComponentsFromQuery(query: QueryInstance): Record<string, ComponentInstance<unknown>> {
  /** @todo caching */
  return query.archetypes.flatMap(_getComponents).reduce((obj, component) => {
    obj[component.name] = component;
    return obj;
  }, {} as Record<string, ComponentInstance<unknown>>);
}

/** helper function for flat-mapping archetype entities */
function _getEntities(archetype: Archetype): number[] {
  return [...archetype.entities];
}

/** Get an array of all entities in a query */
export function getEntitiesFromQuery(query: QueryInstance): Entity[] {
  /** @todo caching */
  return query.archetypes.flatMap(_getEntities);
}

/**
 * Registers a query in a world
 * @param world the world to register the query in
 * @param query the query to register
 * @returns the registered query instance
 */
export async function createQueryInstance(world: World, query: Query): Promise<QueryInstance> {
  const { components, queries } = world;

  if (queries.has(query)) return queries.get(query) as QueryInstance;

  const _getInstance = async (component: Component<unknown>) => {
    const idx = await indexOf(components, component);
    if (idx === -1) throw new Error("ComponentInstance not found.");
    return components[idx];
  };

  const [all, any, none] = await Promise.all([
    await Promise.all(query.all.map(_getInstance)),
    await Promise.all(query.any.map(_getInstance)),
    await Promise.all(query.none.map(_getInstance)),
  ]);

  const [and, or, not] = await Promise.all([
    createBitmaskFromComponents(world, ...all),
    createBitmaskFromComponents(world, ...any),
    createBitmaskFromComponents(world, ...none),
  ]);

  const instance: QueryInstance = {
    archetypes: [],
    and,
    or,
    not,
    world,
  };

  queries.set(query, instance);

  const archetypes = world.archetypes.values();
  for (const archetype of archetypes) {
    if (isQueryCandidate(instance, archetype)) {
      addArchetypeToQuery(instance, archetype);
    }
  }

  return instance;
}
