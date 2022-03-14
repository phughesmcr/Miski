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
export type Query = Readonly<{
  /** AND - Gather entities as long as they have all these components */
  all: Readonly<Component<unknown>[]>;
  /** OR - Gather entities as long as they have 0...* of these components */
  any: Readonly<Component<unknown>[]>;
  /** NOT - Gather entities as long as they don't have these components */
  none: Readonly<Component<unknown>[]>;
}>;

function _validateQueryArrays<T>(component: Component<T>) {
  return Object.prototype.hasOwnProperty.call(component, "name");
}

export function isValidQuery(object: unknown): object is Query {
  const { any = EMPTY_ARRAY, all = EMPTY_ARRAY, none = EMPTY_ARRAY } = object as Query;
  return [...all, ...any, ...none].every(_validateQueryArrays);
}

/**
 * Create a new Query
 * @param spec The Query's specification object
 * @param spec.all AND - Gather entities as long as they have all these components
 * @param spec.any OR - Gather entities as long as they have 0...* of these components
 * @param spec.none NOT - Gather entities as long as they don't have these components
 */
export function createQuery(spec: QuerySpec): Query {
  if (!spec) throw new SyntaxError("createQuery: specification object is required.");
  const { all = EMPTY_ARRAY, any = EMPTY_ARRAY, none = EMPTY_ARRAY } = spec;
  if (![...all, ...any, ...none].every(_validateQueryArrays)) {
    throw new SyntaxError("createQuery: Query specification object is invalid.");
  }
  return Object.freeze({
    all: Object.freeze([...all]),
    any: Object.freeze([...any]),
    none: Object.freeze([...none]),
  });
}
