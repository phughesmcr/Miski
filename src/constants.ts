/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import * as pkg from "../package.json";

/** Miski version */
export const VERSION: string = pkg.version;

/** Default maximum entities value */
export const DEFAULT_MAX_ENTITIES = 1_000_000;

/** Maximum 32-bit integer (2^32 - 1) */
export const MAX_UINT32 = 4_294_967_295;

/** An array of strings that cannot be used for component or schema property names */
export const FORBIDDEN_NAMES = Object.freeze([
  // component properties
  "changed",
  "component",
  "count",
  "eid",
  "id",
  "isTag",
  "maxEntities",
  "name",
  "proxy",
  "schema",
  "size",
  // object properties
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

/** The number 8 - to avoid magic numbers */
export const ONE_BYTE = 8;

/** A frozen empty array to avoid multiple object creation at certain points */
export const EMPTY_ARRAY = Object.freeze([]);

/** A symbol for use where returning undefined from an array etc. is desirable */
export const EMPTY_SYMBOL = Symbol("EMPTY");

/** Symbol for use as a key for the `changed` flag getter and setter */
export const $_CHANGED = Symbol("changed");

/** Symbol for use as a key for the `count` flag getter and setter */
export const $_COUNT = Symbol("count");

/** Symbol for use as a key for the `isDirty` flag getter and setter */
export const $_DIRTY = Symbol("dirty");
