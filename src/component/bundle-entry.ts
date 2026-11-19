/**
 * Shape checks and error messages shared by every path that takes `[component]` / `[component, data]` tuples:
 * `create(bundle)`, prefab instantiate overrides and `CommandBuffer.spawn`.
 * @module
 */

import type { ComponentBundleEntryInput } from "@/types/component-bundle.ts";

/** Throw a `TypeError` unless `bundle` is an array. `what` names it, e.g. `"Bundle"`. */
export function assertBundleArray(bundle: unknown, what: string): asserts bundle is readonly unknown[] {
  if (!Array.isArray(bundle)) {
    throw new TypeError(`${what} must be an array of [component] or [component, data] tuples.`);
  }
}

/** Throw a `TypeError` unless `entry` is a `[component]` or `[component, data]` tuple. `what` names the entries. */
export function assertBundleEntry(entry: unknown, what: string): asserts entry is ComponentBundleEntryInput {
  if (!Array.isArray(entry) || (entry.length !== 1 && entry.length !== 2)) {
    throw new TypeError(`${what} must be [component] or [component, data] tuples.`);
  }
}

/** The error for a component listed twice; `where` names the list, e.g. `"bundle"`. */
export function duplicateComponentError(name: string, where: string): RangeError {
  return new RangeError(`Duplicate component "${name}" in ${where}.`);
}

/** The error for a relation passed to a generic component path; `advice` says what to do instead. */
export function relationComponentError(
  name: string,
  advice = "add and remove its pairs with world.relations",
): TypeError {
  return new TypeError(`Component "${name}" is a relation; ${advice}.`);
}
