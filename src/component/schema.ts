/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { isObject, isTypedArrayConstructor, isValidName, TypedArray, TypedArrayConstructor } from "../utils.js";

/** The interface available to end users */
export type SchemaProps<T> = Record<keyof T, number>;

/** Component data storage */
export type SchemaStorage<T> = Record<keyof T, TypedArray>;

/**
 * Schemas are component storage definitions:
 * Schemas use TypedArray objects and so can only store a single number per property per entity.
 *
 * For example, `{ property: Int8Array }`;
 * Values in the array are initialised to 0 by default.
 * To set your own default value: `{ property: [Int8Array, default value] }`.
 */
export type Schema<T> = Record<keyof T, TypedArrayConstructor | [TypedArrayConstructor, number]>;

/** Schema type guard */
export function isValidSchema<T>(schema: unknown): schema is Schema<T> {
  const _validateProps = (value: TypedArrayConstructor | [TypedArrayConstructor, number]) => {
    if (Array.isArray(value)) {
      const [a, b] = value;
      if (!isNaN(b) && isTypedArrayConstructor(a)) return true;
    } else {
      return isTypedArrayConstructor(value);
    }
    return false;
  };
  const _validate = ([name, value]: [string, unknown]) => {
    return isValidName(name) && _validateProps(value as TypedArrayConstructor | [TypedArrayConstructor, number]);
  };
  return isObject(schema) && Object.entries(schema).every(_validate);
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
export function calculateSchemaSize<T>(schema: Schema<T>): number {
  return Object.values(schema).reduce(byteSum, 0) as number;
}
