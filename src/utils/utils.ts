/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { FORBIDDEN_NAMES, MAX_UINT32, VALID_NAME_PATTERN } from "../constants.js";

/** @returns `true` if n is a number, >= 0, <= 2^32 - 1 */
export function isUint32(n: number): n is number {
  return !isNaN(n) && n >= 0 && n <= MAX_UINT32;
}

/** All the various kinds of typed arrays */
export type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/** All the various kinds of typed array constructors */
export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor;

/** Test if an object is a typed array and not a dataview */
export function isTypedArray(object: unknown): object is TypedArray {
  return Boolean(ArrayBuffer.isView(object) && !(object instanceof DataView));
}

/** Test if an object is a typed array constructor (e.g., `Uint8Array`) */
export function isTypedArrayConstructor(object: unknown): object is TypedArrayConstructor {
  return Boolean(typeof object === "function" && Object.prototype.hasOwnProperty.call(object, "BYTES_PER_ELEMENT"));
}

/** @returns `true` if the given string is an valid name / label */
export function isValidName(str: string): boolean {
  return Boolean(
    (typeof str === "string" && str.length > 0 && VALID_NAME_PATTERN.test(str) === true) ||
      !FORBIDDEN_NAMES.includes(str),
  );
}

/** Test if an object is a valid Record  */
export function isObject(object: unknown): object is Record<string, unknown> {
  return Boolean(typeof object === "object" && !Array.isArray(object));
}

/** An empty function for use in Systems */
export function noop(): void {
  return void 0;
}

/** @author https://stackoverflow.com/a/67605309 */
export type ParametersExceptFirst<F> = F extends (arg0: any, ...rest: infer R) => any ? R : never;

/** The parameters of a function omitting the first two parameters */
export type ParametersExceptFirstTwo<F> = F extends (arg0: any, arg1: any, ...rest: infer R) => any ? R : never;

/**
 * Opaque typing allows for nominal types
 * @example
 * type Entity = number;
 * const a: Entity = 1; // a = number;
 * type Entity = Opaque<number, "Entity">;
 * const b: Entity = 1 // b = Entity;
 */
export type Opaque<T, K> = T & { _TYPE: K };

export function createAvailabilityArray(capacity: number): number[] {
  const total = capacity - 1;
  return Array.from({ length: capacity }, (_, i) => total - i);
}

export function sortAscending(a: number, b: number): number {
  return b - a;
}

export function hasOwnProperty<K extends PropertyKey>(key: K) {
  return function <U>(obj: U): obj is U & Record<K, unknown> {
    return Object.prototype.hasOwnProperty.call(obj, key);
  };
}

export function filterEntries<K extends PropertyKey>(keys: K[]) {
  return function <T extends Record<K, unknown>>(obj: T) {
    const reducer = (curr: Record<K, T[K]>, key: K): Record<K, T[K]> => {
      if (hasOwnProperty(key)(obj)) curr[key] = obj[key];
      return curr;
    };
    return keys.reduce(reducer, {} as Record<K, T[K]>);
  };
}

export function getProperty<K extends PropertyKey>(key: K) {
  return function <U extends Record<K, unknown>>(obj: U): U[K] {
    return obj[key];
  };
}

export function getOwnProperty<K extends PropertyKey>(key: K) {
  const hasKey = hasOwnProperty(key);
  return function <U extends Record<K, unknown>>(obj: U): U[K] | undefined {
    return hasKey(obj) ? obj[key] : undefined;
  };
}

export function intersectBits(a = 0, b = 0): number {
  return a & b;
}

export function roundUpToMultipleOf(f: number): (n: number) => number {
  return (n: number) => Math.ceil(n / f) * f;
}

export const multipleOf4 = roundUpToMultipleOf(4);
