/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { Component } from "../component/component.js";
import type { Schema } from "../component/schema.js";
import { EMPTY_ARRAY } from "../constants.js";

export interface QuerySpec {
  /** AND - Gather entities as long as they have all these components */
  all?: Component<any>[];
  /** OR - Gather entities as long as they have 0...* of these components */
  any?: Component<any>[];
  /** NOT - Gather entities as long as they don't have these components */
  none?: Component<any>[];
}

function _validateQueryArrays<T extends Schema<T>>(component: Component<T>) {
  return component instanceof Component;
}

export class Query {
  /** AND - Gather entities as long as they have all these components */
  readonly all: Readonly<Component<any>[]>;
  /** OR - Gather entities as long as they have 0...* of these components */
  readonly any: Readonly<Component<any>[]>;
  /** NOT - Gather entities as long as they don't have these components */
  readonly none: Readonly<Component<any>[]>;

  /**
   * Create a new Query
   *
   * Queries are groupings of archetypes
   *
   * @param spec The Query's specification object
   * @param spec.all AND - Gather entities as long as they have all these components
   * @param spec.any OR - Gather entities as long as they have 0...* of these components
   * @param spec.none NOT - Gather entities as long as they don't have these components
   * @throws If the spec is invalid
   */
  constructor(spec: QuerySpec) {
    if (!spec) throw new SyntaxError("Query specification object is required.");
    const { all = EMPTY_ARRAY, any = EMPTY_ARRAY, none = EMPTY_ARRAY } = spec;
    if (![...all, ...any, ...none].every(_validateQueryArrays)) {
      throw new SyntaxError("Query specification object is invalid.");
    }
    this.all = Object.freeze([...new Set(all)]);
    this.any = Object.freeze([...new Set(any)]);
    this.none = Object.freeze([...new Set(none)]);
    Object.freeze(this);
  }
}
