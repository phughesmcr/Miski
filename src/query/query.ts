/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Component } from "../component/component.js";
import { EMPTY_ARRAY } from "../constants.js";

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
  const { all = EMPTY_ARRAY, any = EMPTY_ARRAY, none = EMPTY_ARRAY } = spec;
  if (![...all, ...any, ...none].every((component) => Object.prototype.hasOwnProperty.call(component, "name"))) {
    throw new SyntaxError("Query specification object is invalid.");
  }
  return Object.freeze({
    all: Object.freeze([...all]),
    any: Object.freeze([...any]),
    none: Object.freeze([...none]),
  });
}
