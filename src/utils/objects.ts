/**
 * @description Utilities for handling and manipulating objects
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

// Generic Structure of Arrays
export type SOA<T> = { [K in keyof T]: T[K][] };

/** Determine if a given item is an object and not an array */
export function isObject(item: unknown): item is Record<string, unknown> {
  return Boolean(item != undefined && typeof item === "object" && !Array.isArray(item));
}

/** Delete all the properties from an object */
export function clearObject(obj: Record<string, unknown>): Record<string, unknown> {
  Object.keys(obj).forEach((key) => delete obj[key]);
  return obj;
}

/** Recursively copy the properties of source objects to a target object */
export function deepAssignObjects(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  if (!sources || !sources.length) return target;

  const source = sources.shift() as Record<string, unknown>;
  const properties = Object.getOwnPropertyDescriptors(source);

  Object.entries(properties).forEach(([key, val]) => {
    if (val.value !== undefined) {
      if (isObject(val.value)) {
        val.value = deepAssignObjects({}, val.value);
      } else if (Array.isArray(val.value)) {
        val.value = val.value.slice();
      }
    }
    Object.defineProperty(target, key, val);
  });

  return deepAssignObjects(target, ...sources);
}
