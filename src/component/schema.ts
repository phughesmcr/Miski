/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { isObject, isTypedArrayConstructor, isValidName } from "../utils/utils.js";
import type { TypedArray, TypedArrayConstructor } from "../utils/utils.js";

/** Individual entity's component properties */
export type SchemaProps<T> = Record<keyof T, number | bigint | undefined>;

/** Internal component data storage */
export type SchemaStorage<T> = Record<keyof T, TypedArray>;

/**
 * Schemas are component storage definitions:
 *
 * Schemas use TypedArray objects and so can only store a single number per property per entity.
 *
 * For example, `{ property: Int8Array }`;
 *
 * Values in TypedArrays are initialised to 0 by default.
 *
 * To set an initial value: `{ property: [Int8Array, defaultValue] }`.
 *
 * Set to `null` to define a tag component.
 */
export type Schema<T> = null | Record<keyof T, TypedArrayConstructor | [TypedArrayConstructor, number]>;

/** Validates the properties of a schema entry */
function _validateProps(value: TypedArrayConstructor | [TypedArrayConstructor, number]): boolean {
  if (Array.isArray(value)) {
    // if this is an array, the user wants to set an initial value
    const [TAC, n] = value;
    return !isNaN(n) && isTypedArrayConstructor(TAC);
  }
  return isTypedArrayConstructor(value);
}

/** Validates the names and values of a schema's entries */
function _validateSchemaEntry([name, value]: [string, unknown]): boolean {
  return isValidName(name) && _validateProps(value as TypedArrayConstructor | [TypedArrayConstructor, number]);
}

/** Schema type guard */
export function isValidSchema<T extends Schema<T>>(schema: unknown): schema is Schema<T> {
  try {
    if (schema === undefined) return false;
    if (schema === null) return true;
    if (!isObject(schema)) return false;
    const entries = Object.entries(schema);
    if (!entries.length) return false;
    return entries.every(_validateSchemaEntry);
  } catch (_) {
    return false;
  }
}

/**
 * Utility function to add a typed array's bytes per element to a total
 * @see calculateSchemaSize
 */
function byteSum(total: unknown, value: unknown): number {
  const size = Array.isArray(value)
    ? (value[0] as TypedArray).BYTES_PER_ELEMENT
    : (value as TypedArray).BYTES_PER_ELEMENT;
  return (total as number) + size;
}

/**
 * @returns the size in bytes that a component's storage requires for one entity
 *          or NaN if the object is invalid;
 */
export function calculateSchemaSize<T extends Schema<T>>(schema: Schema<T>): number {
  try {
    if (!isValidSchema(schema)) return Number.NaN;
    if (schema === null) return 0;
    /** @todo should this be to multipleOf4? */
    return Object.values(schema).reduce(byteSum, 0) as number;
  } catch (_) {
    return Number.NaN;
  }
}
