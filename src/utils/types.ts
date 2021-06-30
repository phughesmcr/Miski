/**
 * @description Utilities for handling and manipulating schema types
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 *
 * Heavily inspired by ECSY
 */
"use strict";

import { deepAssignObjects, isObject } from "./objects";

export type TypeCopyFunction<T> = (src: T, dest: T) => T;

export type TypeCloneFunction<T> = (value: T) => T;

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

/**
 * @syntax <string, TypedArrayConstructor>
 * @example const x = new TypedArrayMap.Int8Array();
 */
export const TypedArrayMap: Record<string, TypedArrayConstructor> = {
  Int8Array: Int8Array,
  Uint8Array: Uint8Array,
  Uint8ClampedArray: Uint8ClampedArray,
  Int16Array: Int16Array,
  Uint16Array: Uint16Array,
  Int32Array: Int32Array,
  Uint32Array: Uint32Array,
  Float32Array: Float32Array,
  Float64Array: Float64Array,
  BigInt64Array: BigInt64Array,
  BigUint64Array: BigUint64Array,
};

/**
 * Test if an object is a typed array
 * @param object the object to test
 * @returns true if the object is a typed array
 */
export function isTypedArray(object: unknown): object is TypedArrayConstructor {
  return Boolean(object && ArrayBuffer.isView(object) && !(object instanceof DataView));
}

/**
 * Copy the contents of one array into another
 * @param src the contents to copy
 * @param dest the array to copy the contents into
 * @returns the destination array
 */
export function copyArray<T>(src: Array<T>, dest: Array<T>): Array<T> {
  if (!Array.isArray(src)) {
    throw new TypeError(`copyArray: Source must be an array, found ${typeof src}.`);
  }
  if (!Array.isArray(dest)) {
    throw new TypeError(`copyArray: Destination must be an array, found ${typeof dest}.`);
  }
  dest.length = 0;
  src.forEach((i) => dest.push(i));
  return dest;
}

/**
 * Create a new array from an existing array
 * @param src the array to clone
 * @returns the cloned array
 */
export function cloneArray<T>(src: Array<T>): Array<T> {
  if (!Array.isArray(src)) {
    throw new TypeError(`cloneArray: Source must be an array, found ${typeof src}.`);
  }
  return [...src];
}

/**
 * Copy the contents of one JSON object into another
 * @param src the JSON object to copy
 * @param dest the JSON object to append
 * @returns the destination object
 */
export function copyJSON(src: unknown, dest: unknown): unknown {
  if (typeof src === "string") {
    src = JSON.parse(src);
  }
  if (isObject(src) === false) {
    throw new TypeError(`copyJSON: Invalid source object, found ${typeof src}.`);
  }
  if (typeof dest === "string") {
    src = JSON.parse(dest);
  }
  if (isObject(dest) === false) {
    throw new TypeError(`copyJSON: Invalid destination object, found ${typeof dest}.`);
  }
  return Object.assign(dest, JSON.parse(JSON.stringify(src)));
}

/**
 * Create a new JSON object from an existing JSON object
 * @param src the JSON object to clone
 * @returns
 */
export function cloneJSON(src: unknown): unknown {
  if (typeof src === "string") {
    src = JSON.parse(src);
  }
  if (isObject(src) === false) {
    throw new TypeError(`cloneJSON: Invalid source object, found ${typeof src}.`);
  }
  return JSON.parse(JSON.stringify(src));
}

/**
 * Overwrite one value with another
 * @param src the value to copy
 * @param dest the value to overwrite
 * @returns the destination value
 */
export function copyValue<T>(src: T, dest: T): T {
  dest = src;
  return dest;
}

/**
 * Returns a given value
 * @param src the source value
 * @returns the cloned value
 */
export function cloneValue<T>(src: T): T {
  return src;
}

/**
 * Copy the properties of one object into another
 * @param src the object to copy
 * @param dest the object to be appended
 * @returns the destination object
 */
export function copyObject<T extends Record<string, unknown>>(src: T, dest: T): T {
  if (isObject(src) === false) {
    throw new TypeError(`copyObject: Invalid source object, found ${typeof src}.`);
  }
  if (isObject(dest) === false) {
    throw new TypeError(`copyObject: Invalid destination object, found ${typeof dest}.`);
  }
  deepAssignObjects(dest, src);
  return dest;
}

/**
 * Create a new object with the properties of an existing object
 * @param src the object to clone
 * @returns the cloned object
 */
export function cloneObject<T extends Record<string, unknown>>(src: T): T {
  return copyObject(src, {} as T);
}

/**
 * Copy the contents of one Map into another
 * @param src the map to copy
 * @param dest the map to append to
 * @returns the destination map
 */
export function copyMap<K, V>(src: Map<K, V>, dest: Map<K, V>): Map<K, V> {
  if (!(src instanceof Map)) {
    throw new TypeError(`copyMap: Expected source to be a Map object.`);
  }
  if (!(dest instanceof Map)) {
    throw new TypeError(`copyMap: Expected destination to be a Map object.`);
  }
  dest.clear();
  src.forEach((val, key) => dest.set(key, val));
  return dest;
}

/**
 * Create a new Map object from an exiting Map
 * @param src the Map to clone
 * @returns the cloned Map
 */
export function cloneMap<K, V>(src: Map<K, V>): Map<K, V> {
  if (!(src instanceof Map)) {
    throw new TypeError(`cloneMap: Expected source to be a Map object.`);
  }
  return new Map(src.entries());
}

/**
 * Copy the contents of one set into another
 * @param src the set to copy
 * @param dest the set to append
 * @returns the destination set
 */
export function copySet<T>(src: Set<T>, dest: Set<T>): Set<T> {
  if (!(src instanceof Set)) {
    throw new TypeError(`copySet: Expected source to be a Set object.`);
  }
  if (!(dest instanceof Set)) {
    throw new TypeError(`copySet: Expected destination to be a Set object.`);
  }
  dest.clear();
  src.forEach((val) => dest.add(val));
  return dest;
}

/**
 * Create a new set from an existing set
 * @param src the set to clone
 * @returns the cloned set
 */
export function cloneSet<T>(src: Set<T>): Set<T> {
  if (!(src instanceof Set)) {
    throw new TypeError(`cloneSet: Expected source to be a Set object.`);
  }
  return new Set(src);
}

/**
 * Copy the contents of one typed array into another
 * @param src the array to be copied
 * @param dest the array to be appended
 * @param offset optional offset parameter
 * @returns the destination array
 */
export function copyTypedArray<T extends TypedArray>(src: T, dest: T, offset = 0): T {
  if (isTypedArray(src) === false) {
    throw new TypeError("copyTypedArray: Expected source to be a typed array.");
  }
  if (isTypedArray(dest) === false) {
    throw new TypeError("copyTypedArray: Expected destination to be a typed array.");
  }
  if (isNaN(offset) || offset < 0) {
    throw new TypeError("copyTypedArray: Offset must be a positive integer of type Number.");
  }
  /** @todo: clear dest first */
  /** @todo: fix this gross type conversion */
  dest.set(src as unknown as ArrayLike<number> & ArrayLike<bigint>, offset);
  return dest;
}

/**
 * Create a new typed array from
 * @param src the array to clone
 * @returns the cloned array
 */
export function cloneTypedArray<T extends TypedArray>(src: T): T {
  if (isTypedArray(src) === false) {
    throw new TypeError("cloneTypedArray: Expected source to be a typed array.");
  }
  return src.slice() as T;
}
