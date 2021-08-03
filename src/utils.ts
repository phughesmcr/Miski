"use strict";

import { ComponentInstance } from "./component.js";
import { Bitmask, createBitmask, setBitOn } from "./mask.js";
import { World } from "./world.js";

/**
 * Create a new bitmask from a set of component IDs
 * @param world the world to associate this mask with
 * @param components components to create a mask from
 * @returns a new bitmask
 */
export function createBitmaskFromComponents(world: World, ...components: ComponentInstance<unknown>[]): Bitmask {
  const mask = createBitmask(world.spec.maxComponents || 32);
  if (!components.length) return mask;
  for (let i = 0, n = components.length; i < n; i++) {
    const component = components[i];
    if (component.world.id !== world.id) {
      throw new Error("Components are not from the same world.");
    }
    setBitOn(mask, component.id);
  }
  return mask;
}

/** Async indexOf */
export async function indexOf<T>(arr: ArrayLike<T>, item: T): Promise<number> {
  for (let i = 0, len = arr.length; i != len; i++) {
    if (arr[i] === item) return Promise.resolve(i);
  }
  return Promise.resolve(-1);
}

/** Garbage free splice */
export function spliceOne<T>(arr: T[], index: number): T[] {
  const length = arr.length;
  if (!length) return arr;
  while (index < length) {
    arr[index] = arr[index + 1];
    index++;
  }
  arr.length = arr.length - 1;
  return arr;
}

/** Test if an object is a valid Record  */
export function isObject(object: unknown): object is Record<string, unknown> {
  return Boolean(typeof object === "object" && !Array.isArray(object));
}

/** An empty function for use in Systems */
export function systemNoop(_: number[]): void {
  return void _;
}

const _validName = /^(?![0-9])[a-zA-Z0-9$_]+$/;

/** Check if a string is a valid property name */
export function isValidName(str: string): boolean {
  if (typeof str !== "string") return false;
  str = str.trim();
  return str.length > 0 && _validName.test(str) && !FORBIDDEN_NAMES.has(str);
}

/** An array of strings that cannot be used for component or system names */
export const FORBIDDEN_NAMES = new Set([
  // component properties
  "entities",
  "id",
  "instances",
  "name",
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
]);

export interface Constructable<T> {
  new (...args: unknown[]): T;
  constructor: (...args: unknown[]) => T;
}

/** Test if an object is a typed array and not a dataview */
export function isTypedArray(object: unknown): object is TypedArrayConstructor {
  return Boolean(ArrayBuffer.isView(object) && !(object instanceof DataView));
}

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
