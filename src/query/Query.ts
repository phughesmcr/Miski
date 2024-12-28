/**
 * @module      Query
 * @description A Query is a collection of Components that can be used to find Entities
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { type Component, isValidComponentArray, type SchemaOrNull } from "../component/Component.ts";
import { isObject } from "../utils.ts";

/** The Query constructor specification */
export type QuerySpec = {
  /** `AND` - Gather entities as long as they have all these components */
  all?: Component<SchemaOrNull>[];
  /** `OR` - Gather entities as long as they have 0...* of these components */
  any?: Component<SchemaOrNull>[];
  /** `NOT` - Gather entities as long as they don't have these components */
  none?: Component<SchemaOrNull>[];
};

/**
 * Type guard for QuerySpec
 * @param spec The specification object to check
 * @returns `true` if the spec is valid, `false` otherwise
 */
export const isQuerySpec = (spec: unknown): spec is QuerySpec => {
  if (!isObject(spec)) return false;
  const { all, any, none } = spec as QuerySpec;
  if (!all && !any && !none) return false;
  if (all && !isValidComponentArray(all)) return false;
  if (any && !isValidComponentArray(any)) return false;
  if (none && !isValidComponentArray(none)) return false;
  return true;
};

/** A Query is a collection of Components that can be used to find Entities */
export class Query {
  /** `AND` - Gather entities as long as they have all these components */
  readonly all: Component<SchemaOrNull>[];

  /** `OR` - Gather entities as long as they have 0...* of these components */
  readonly any: Component<SchemaOrNull>[];

  /** `NOT` - Gather entities as long as they don't have these components */
  readonly none: Component<SchemaOrNull>[];

  /**
   * Create a new Query
   * @param spec The Query's specification object
   * @param spec.all `AND` - Gather entities as long as they have all these components
   * @param spec.any `OR` - Gather entities as long as they have 0...* of these components
   * @param spec.none `NOT` - Gather entities as long as they don't have these components
   * @returns A new Query object
   * @throws {TypeError} if the spec is invalid
   */
  private constructor(spec: QuerySpec) {
    if (!isQuerySpec(spec)) {
      throw new TypeError("Query specification object is invalid.");
    }
    this.all = [...new Set(spec.all ?? [])];
    this.any = [...new Set(spec.any ?? [])];
    this.none = [...new Set(spec.none ?? [])];
  }
}
