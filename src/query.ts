"use strict";

import { Archetype } from "./archetype.js";
import { Component, ComponentInstance, isValidComponent } from "./component.js";
import { Entity } from "./entity.js";
import { Bitmask } from "./mask.js";
import { createBitmaskFromComponents, spliceOne } from "./utils.js";
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
  /** The components matched by the and/or bitmasks */
  components: Record<string, ComponentInstance<unknown>>;
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
  const valid = [...all, ...any, ...none].every(isValidComponent);
  if (!valid) throw new Error("Spec arrays must contain only Components.");
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

/** Get an object of components by name */
export function getComponentsFromQuery(query: QueryInstance): Record<string, ComponentInstance<unknown>> {
  return query.components;
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
export function createQueryInstance(world: World, query: Query): QueryInstance {
  const { queries } = world;

  if (queries.has(query)) return queries.get(query) as QueryInstance;

  const _sameWorld = (c: ComponentInstance<unknown>) => c.world === world;
  const _getInstance = (component: Component<unknown>) => component.instances.filter(_sameWorld);

  const all = query.all.flatMap(_getInstance);
  const any = query.any.flatMap(_getInstance);
  const none = query.none.flatMap(_getInstance);

  const and = createBitmaskFromComponents(world, ...all);
  const or = createBitmaskFromComponents(world, ...any);
  const not = createBitmaskFromComponents(world, ...none);

  const components = Object.freeze(
    [...all, ...any].reduce((obj, component) => {
      obj[component.name] = component;
      return obj;
    }, {} as Record<string, ComponentInstance<unknown>>)
  );

  const instance: QueryInstance = {
    archetypes: [],
    components,
    and,
    or,
    not,
    world,
  };

  queries.set(query, instance);

  const archetypes = [...world.archetypes.values()];
  for (let i = 0, n = archetypes.length; i < n; i++) {
    const archetype = archetypes[i];
    if (isQueryCandidate(instance, archetype)) {
      addArchetypeToQuery(instance, archetype);
    }
  }

  return instance;
}
