import { isValidName as isValidNamePartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { INVALID_NAMES, MAX_UINT32, MIN_UINT32 } from "./constants.ts";
import type { TypedArray } from "./types/partitions.ts";

/** @return `true` if the object has the given key */
export function hasOwnProperty<T>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** @returns `true` if ```typeof n === 'number'``` */
function isNumber(n: unknown): n is number {
  return typeof n === "number";
}

/** @returns `true` if n is an integer, >= 0, <= 2^32 - 1 (4294967295)*/
export function isUint32(n: unknown): n is number {
  return isNumber(n) && Number.isInteger(n) && n >= MIN_UINT32 && n <= MAX_UINT32;
}

/** @returns true if `n` is an integer Uint32 > 0 */
export function isPositiveUint32(n: unknown): n is number {
  return isUint32(n) && n > 0;
}

/** Test if an object is a valid Record  */
export function isObject<T extends Record<string, unknown>>(object: unknown): object is T {
  return (typeof object === "object" && object !== null && !Array.isArray(object));
}

/**
 * Convert a string representation of a number array to an array of numbers
 * @param str The string representation of the number array
 * @returns The array of numbers
 * @example
 * ```ts
 * numberArrayFromString("1,2,3") // [1, 2, 3]
 * numberArrayFromString("[1,2,3]") // [1, 2, 3]
 * ```
 */
export function numberArrayFromString(str: string): number[] {
  return str
    .replaceAll(/[\[\]]/g, "")
    .split(",")
    .map((n) => parseInt(n, 10));
}

/**
 * A no-operation function
 * @returns {void}
 */
export function noop(..._args: unknown[]): void {}

/**
 * Test if a name is valid
 * @param name The name to test
 * @returns `true` if the name is valid
 */
export function isValidName(name: string): boolean {
  const initial = isValidNamePartitionedBuffer(name);
  return initial && !INVALID_NAMES.includes(name);
}

/** @returns `true` if `value` is a thenable */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as PromiseLike<unknown>).then === "function";
}

/** Copy `array` into a new typed array of the same type and `length` (at least `array.length`). */
export function growTypedArray<T extends TypedArray>(array: T, length: number): T {
  const next = new (array.constructor as new (length: number) => T)(length);
  (next as unknown as { set(source: ArrayLike<number>): void }).set(array as ArrayLike<number>);
  return next;
}
