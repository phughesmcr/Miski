/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import {
  isObject,
  isTypedArrayConstructor,
  isValidName,
  multipleOf4,
  TypedArray,
  TypedArrayConstructor,
} from "../utils/utils.js";

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
    if (!isNaN(n) && isTypedArrayConstructor(TAC)) return true;
  } else {
    return isTypedArrayConstructor(value);
  }
  return false;
}

/** Validates the names and values of a schema's entries */
function _validateSchemaEntry([name, value]: [string, unknown]): boolean {
  return isValidName(name) && _validateProps(value as TypedArrayConstructor | [TypedArrayConstructor, number]);
}

/** Schema type guard */
export function isValidSchema<T extends Schema<T>>(schema: unknown): schema is Schema<T> {
  return isObject(schema) && Object.entries(schema).every(_validateSchemaEntry);
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

/** @returns the size in bytes that a component's storage requires for one entity */
export function calculateSchemaSize<T extends Schema<T>>(schema: Schema<T>): number {
  if (!schema) return 0;
  return multipleOf4(Object.values(schema).reduce(byteSum, 0) as number);
}
