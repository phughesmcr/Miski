/**
 * @module      query/match
 * @description Bitfield query matching helpers.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { BooleanArray } from "@phughesmcr/booleanarray";

import type { QueryInstance } from "@/types/query.ts";

/**
 * Check if a target bitfield matches query requirements
 * @param target The target bitfield to check
 * @param query The query instance to match against
 * @returns true if the target matches the query requirements
 */
export function isQueryMatch(target: BooleanArray, query: QueryInstance): boolean {
  if (target.isEmpty()) return false;
  if (!target.containsAll(query.and)) return false;
  if (target.intersects(query.not)) return false;
  return query.or.isEmpty() || target.intersects(query.or);
}
