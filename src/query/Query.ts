/**
 * @module      Query
 * @description A Query is a collection of Components that can be used to find Entities
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { isObject } from "../utils.ts";
import { SpecError } from "../errors.ts";
import { type Component, isValidComponentArray } from "../component/Component.ts";
import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { QueryInstance, QuerySpec, SchemaOrNull } from "../types.ts";

/**
 * Type guard for QuerySpec
 * @param spec The specification object to check
 * @returns `true` if the spec is valid, `false` otherwise
 */
export const isValidQuerySpec = (spec: unknown): spec is QuerySpec => {
  if (isObject(spec) === false) return false;
  const { all, any, none } = spec as QuerySpec;
  // ensure at least one of the arrays is defined
  if (all == undefined && any == undefined && none == undefined) return false;
  // ensure all arrays are valid component arrays
  if (all && isValidComponentArray(all) === false) return false;
  if (any && isValidComponentArray(any) === false) return false;
  if (none && isValidComponentArray(none) === false) return false;
  // check for presence of component in multiple arrays
  if (all && any && all.some((c) => any.includes(c))) return false;
  if (all && none && all.some((c) => none.includes(c))) return false;
  if (any && all && any.some((c) => all.includes(c))) return false;
  if (any && none && any.some((c) => none.includes(c))) return false;
  if (none && all && none.some((c) => all.includes(c))) return false;
  if (none && any && none.some((c) => any.includes(c))) return false;
  return true;
};

/** A Query is a collection of Components that can be used to find Entities */
export class Query {
  /**
   * Compose a new Query from an array of Queries
   * @param queries - The Queries to compose
   * @returns A new Query object
   */
  static compose(queries: Query[]): Query {
    return new Query({
      all: queries.flatMap((q) => q.all),
      any: queries.flatMap((q) => q.any),
      none: queries.flatMap((q) => q.none),
    });
  }

  /** `AND` - Gather entities as long as they have all these components */
  readonly all: Readonly<Component<SchemaOrNull<any>>[]>;

  /** `OR` - Gather entities as long as they have 0...* of these components */
  readonly any: Readonly<Component<SchemaOrNull<any>>[]>;

  /** `NOT` - Gather entities as long as they don't have these components */
  readonly none: Readonly<Component<SchemaOrNull<any>>[]>;

  /**
   * Create a new Query
   * @param spec - The Query's specification object
   * @param spec.all - `AND` - Gather entities as long as they have all these components
   * @param spec.any - `OR` - Gather entities as long as they have 0...* of these components
   * @param spec.none - `NOT` - Gather entities as long as they don't have these components
   * @returns A new Query object
   * @throws {SpecError} if the spec is invalid
   */
  constructor(spec: QuerySpec) {
    if (isValidQuerySpec(spec) === false) {
      throw new SpecError("Query specification object is invalid.");
    }
    this.all = Object.freeze([...new Set(spec.all ?? [])]);
    this.any = Object.freeze([...new Set(spec.any ?? [])]);
    this.none = Object.freeze([...new Set(spec.none ?? [])]);
  }
}

/**
 * Check if a target bitfield matches query requirements
 * @param target The target bitfield to check
 * @param query The query instance to match against
 * @returns true if the target matches the query requirements
 */
export function isQueryMatch(target: BooleanArray, query: QueryInstance): boolean {
  // Empty targets should never match
  if (target.getTruthyCount() === 0) return false;

  // Check AND components
  for (let i = 0; i < target.length; i++) {
    const t = target.buffer[i] ?? 0;
    const and = query.and.buffer[i] ?? 0;
    if ((t & and) !== and) return false;
  }

  // Check NOT components
  for (let i = 0; i < target.length; i++) {
    const t = target.buffer[i] ?? 0;
    const not = query.not.buffer[i] ?? 0;
    if ((t & not) !== 0) return false;
  }

  // Check OR components
  if (query.or.getTruthyCount() > 0) {
    let hasOr = false;
    for (let i = 0; i < target.length; i++) {
      const t = target.buffer[i] ?? 0;
      const or = query.or.buffer[i] ?? 0;
      if ((t & or) !== 0) {
        hasOr = true;
        break;
      }
    }
    if (!hasOr) return false;
  }

  return true;
}
