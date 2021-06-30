/**
 * @description Utilities for handling and manipulating strings
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */

/** An array of strings that cannot be used for component or system names */
export const FORBIDDEN_NAMES = [
  // component properties
  "defaults",
  "id",
  "name",
  "entities",
  "schema",
  "world",
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
];

export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

/** Check if a string is a valid property name */
export function isValidName(str: string): boolean {
  if (typeof str !== "string") {
    throw new TypeError(`Expected name to be of type "string", found ${typeof str}.`);
  }
  str = str.trim();
  return str.length > 0 && /^(?![0-9])[a-zA-Z0-9$_]+$/.test(str) && !FORBIDDEN_NAMES.includes(str);
}
