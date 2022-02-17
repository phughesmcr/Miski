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
  "component",
  "id",
  "isTag",
  "name",
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