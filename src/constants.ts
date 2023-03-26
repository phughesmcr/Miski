/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

/** Miski version */
export const VERSION = "__VERSION__"; // __VERSION__ is replaced by rollup

/** Maximum 32-bit integer (2^32 - 1) */
export const MAX_UINT32 = 4_294_967_295;

/** An array of strings that cannot be used for component or schema property names */
export const FORBIDDEN_NAMES = Object.freeze(
  new Set([
    // component properties:
    "changed",
    "component",
    "count",
    "eid",
    "entity",
    "id",
    "isTag",
    "maxEntities",
    "name",
    "owners",
    "proxy",
    "schema",
    "size",
    // object properties:
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "prototype",
    "toLocaleString",
    "toString",
    "valueOf",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupGetter__",
    "__proto__",
  ]),
);

/** Valid string name characters */
export const VALID_NAME_PATTERN = /^(?![0-9])[a-zA-Z0-9$_]+$/;

/** A frozen empty array to avoid multiple object creation at certain points */
export const EMPTY_ARRAY = Object.freeze([]);

/** Symbol for use as a key for the `changed` flag getter and setter */
export const $_CHANGED = Symbol("changed");

/** Symbol for use as a key for the `owners` flag getter and setter */
export const $_OWNERS = Symbol("owners");
