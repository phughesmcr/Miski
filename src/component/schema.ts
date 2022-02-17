/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { isObject, isValidName, TypedArray, TypedArrayConstructor } from "../utils.js";

/** The interface available to end users */
export type SchemaProps<T> = Record<keyof T, number>;

/** Component data storage */
export type SchemaStorage<T> = Record<keyof T, TypedArray>;

/** Schemas are component storage definitions: e.g., { property: Int8Array } */
export type Schema<T> = Record<keyof T, TypedArrayConstructor>;

/** Schema type guard */
export function isValidSchema<T>(schema: unknown): schema is Schema<T> {
  return isObject(schema) && Object.keys(schema).every((name) => isValidName(name));
}

/**
 * Utility function to add a typed array's bytes per element to a total
 * @see calculateSchemaSize
 */
function byteSum(total: unknown, value: unknown): number {
  return (total as number) + (value as TypedArray).BYTES_PER_ELEMENT;
}

/** @returns the size in bytes that a component's storage requires for one entity */
export function calculateSchemaSize<T>(schema: Schema<T>): number {
  return Object.values(schema).reduce(byteSum, 0) as number;
}
