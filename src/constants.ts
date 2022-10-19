/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/** Miski version */
export const VERSION: string = "__VERSION__"; // __VERSION__ is replaced by rollup

/** Maximum 32-bit integer (2^32 - 1) */
export const MAX_UINT32 = 4_294_967_295;

/** An array of strings that cannot be used for component or schema property names */
export const FORBIDDEN_NAMES = Object.freeze([
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
]);

/** Valid string name characters */
export const VALID_NAME_PATTERN = /^(?![0-9])[a-zA-Z0-9$_]+$/;

/** A frozen empty array to avoid multiple object creation at certain points */
export const EMPTY_ARRAY = Object.freeze([]);

/** Symbol for use as a key for the `changed` flag getter and setter */
export const $_CHANGED = Symbol("changed");

/** Symbol for use as a key for the `owners` flag getter and setter */
export const $_OWNERS = Symbol("owners");

/** Lookup table for powers of 2 */
export const LOG_2: Record<number, number> = Object.freeze({
  1: 0,
  2: 1,
  4: 2,
  8: 3,
  16: 4,
  32: 5,
  64: 6,
  128: 7,
  256: 8,
  512: 9,
  1024: 10,
  2048: 11,
  4096: 12,
  8192: 13,
  16384: 14,
  32768: 15,
  65536: 16,
  131072: 17,
  262144: 18,
  524288: 19,
  1048576: 20,
  2097152: 21,
  4194304: 22,
  8388608: 23,
  16777216: 24,
  33554432: 25,
  67108864: 26,
  134217728: 27,
  268435456: 28,
  536870912: 29,
  1073741824: 30,
  2147483648: 31,
});
