/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { FORBIDDEN_NAMES, MAX_UINT32, VALID_NAME_PATTERN } from "./constants.js";

/** @returns `true` if n is a number, >= 0, <= 2^32 - 1 */
export function isUint32(n: number): n is number {
  return !isNaN(n) && n >= 0 && n <= MAX_UINT32;
}

/** Test if an object is a typed array and not a dataview */
export function isTypedArray(object: unknown): object is TypedArrayConstructor {
  return Boolean(ArrayBuffer.isView(object) && !(object instanceof DataView));
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

/** */
export const pipe =
  <T, U>(...fns: ((arg: T) => T)[]) =>
  (value: T) =>
    fns.reduce((acc, fn) => fn(acc), value) as unknown as U;

/** @author https://stackoverflow.com/a/67605309 */
export type ParametersExceptFirst<F> = F extends (arg0: any, ...rest: infer R) => any ? R : never;
