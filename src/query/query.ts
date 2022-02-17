/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Component, ComponentRecord } from "../component/component.js";
import { Entity } from "../entity.js";
import { World } from "../world.js";
import { createQueryInstance } from "./instance.js";

export interface QuerySpec {
  /** AND - Gather entities as long as they have all these components */
  all?: Readonly<Component<unknown>[]>;
  /** OR - Gather entities as long as they have 0...* of these components */
  any?: Readonly<Component<unknown>[]>;
  /** NOT - Gather entities as long as they don't have these components */
  none?: Readonly<Component<unknown>[]>;
}

/** Queries are groupings of archetypes */
export interface Query {
  /** AND - Gather entities as long as they have all these components */
  all: Readonly<Component<unknown>[]>;
  /** OR - Gather entities as long as they have 0...* of these components */
  any: Readonly<Component<unknown>[]>;
  /**
   * Get the result of the query for a given world
   * @returns a tuple of Entities and Components which match the Query criteria
   */
  getResult: (world: World) => [Entity[], ComponentRecord];
  /** NOT - Gather entities as long as they don't have these components */
  none: Readonly<Component<unknown>[]>;
}

/**
 * Create a new Query
 * @param spec The Query's specification object
 * @param spec.all
 * @param spec.any
 * @param spec.none
 */
export function createQuery(spec: QuerySpec): Readonly<Query> {
  if (!spec) throw new SyntaxError("createQuery: specification object is required.");
  const { all = [], any = [], none = [] } = spec;
  if (![...all, ...any, ...none].every((component) => Object.prototype.hasOwnProperty.call(component, "name"))) {
    throw new SyntaxError("Query specification object is invalid.");
  }
  const query = {
    all: Object.freeze([...all]),
    any: Object.freeze([...any]),
    none: Object.freeze([...none]),
  } as Query;
  query.getResult = function (world: World): [Entity[], ComponentRecord] {
    const { components, bitfieldFactory, queries } = world;
    let instance = queries.get(query);
    if (!instance) {
      instance = createQueryInstance({ components, bitfieldFactory, query });
      queries.set(query, instance);
    }
    return [instance.getEntities(), instance.getComponents()];
  };
  return Object.freeze(query);
}
