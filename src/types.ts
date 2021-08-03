/** Data storage for common types */
"use strict";

import { DataStore, defineDataStore } from "./schema.js";
import { isObject } from "./utils.js";

// Type unsafe storage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStore = DataStore<any[], any>;
// Typed array storage
export type Int8Store = DataStore<Int8Array, number>;
export type Uint8Store = DataStore<Uint8Array, number>;
export type ClampedUint8Store = DataStore<Uint8ClampedArray, number>;
export type Int16Store = DataStore<Int16Array, number>;
export type Uint16Store = DataStore<Uint16Array, number>;
export type Int32Store = DataStore<Int32Array, number>;
export type Uint32Store = DataStore<Uint32Array, number>;
export type Float32Store = DataStore<Float32Array, number>;
export type Float64Store = DataStore<Float64Array, number>;
export type BigintStore = DataStore<BigInt64Array, number>;
export type BigUintStore = DataStore<BigUint64Array, number>;
// Primitive storage
export type ArrayStore<T> = DataStore<T[][], T[]>;
export type BooleanStore = DataStore<boolean[], boolean>;
export type FunctionStore = DataStore<((...args: unknown[]) => unknown)[], (...args: unknown[]) => unknown>;
export type NumberStore = DataStore<number[], number>;
export type ObjectStore<T> = DataStore<T[], T>;
export type StringStore = DataStore<string[], string>;

/** number type guard */
export function numberGuard(property: unknown): property is number {
  return typeof property === "number" && !isNaN(property);
}

/** @returns 0 */
export function initToZero(): number {
  return 0;
}

/** Type unsafe data storage */
export const any: AnyStore = defineDataStore({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guard: (_property: unknown): _property is any => true,
  initial: () => undefined,
  name: "any",
});

/** Int8 data storage */
export const i8: Int8Store = defineDataStore({
  arrayType: Int8Array,
  guard: numberGuard,
  initial: initToZero,
  name: "i8",
});

/** Uint8 data storage */
export const ui8: Uint8Store = defineDataStore({
  arrayType: Uint8Array,
  guard: numberGuard,
  initial: initToZero,
  name: "ui8",
});

/** Clamped uint8 data storage */
export const ui8c: ClampedUint8Store = defineDataStore({
  arrayType: Uint8ClampedArray,
  guard: numberGuard,
  initial: initToZero,
  name: "ui8c",
});

/** Int16 data storage */
export const i16: Int16Store = defineDataStore({
  arrayType: Int16Array,
  guard: numberGuard,
  initial: initToZero,
  name: "i16",
});

/** Uint16 data storage */
export const ui16: Uint16Store = defineDataStore({
  arrayType: Uint16Array,
  guard: numberGuard,
  initial: initToZero,
  name: "ui16",
});

/** Int32 data storage */
export const i32: Int32Store = defineDataStore({
  arrayType: Int32Array,
  guard: numberGuard,
  initial: initToZero,
  name: "i32",
});

/** Uint32 data storage */
export const ui32: Uint32Store = defineDataStore({
  arrayType: Uint32Array,
  guard: numberGuard,
  initial: initToZero,
  name: "ui32",
});

/** Int64 data storage */
export const i64: BigintStore = defineDataStore({
  arrayType: BigInt64Array,
  guard: numberGuard,
  initial: initToZero,
  name: "i64",
});

/** Uint64 data storage */
export const ui64: BigUintStore = defineDataStore({
  arrayType: BigUint64Array,
  guard: numberGuard,
  initial: initToZero,
  name: "ui64",
});

/** Float32 data storage */
export const f32: Float32Store = defineDataStore({
  arrayType: Float32Array,
  guard: numberGuard,
  initial: initToZero,
  name: "f32",
});

/** Float64 data storage */
export const f64: Float64Store = defineDataStore({
  arrayType: Int32Array,
  guard: numberGuard,
  initial: initToZero,
  name: "f64",
});

/** Array data storage */
export const array: ArrayStore<unknown> = defineDataStore({
  guard: (property: unknown): property is unknown[] => Array.isArray(property),
  initial: () => [],
  name: "array",
});

/** Boolean data storage */
export const boolean: BooleanStore = defineDataStore({
  guard: (property: unknown): property is boolean => typeof property === "boolean",
  initial: () => false,
  name: "boolean",
});

/** Function data storage */
export const fnc: FunctionStore = defineDataStore({
  guard: (property: unknown): property is (...args: unknown[]) => unknown => typeof property === "function",
  initial: () => () => void 0,
  name: "function",
});

/** Number data storage */
export const number: NumberStore = defineDataStore({
  guard: numberGuard,
  initial: initToZero,
  name: "number",
});

/** Object data storage */
// eslint-disable-next-line @typescript-eslint/ban-types
export const object: ObjectStore<object> = defineDataStore({
  // eslint-disable-next-line @typescript-eslint/ban-types
  guard: (property: unknown): property is object => isObject(property),
  initial: () => ({}),
  name: "object",
});

/** String data storage */
export const string: StringStore = defineDataStore({
  guard: (property: unknown): property is string => typeof property === "string",
  initial: () => "",
  name: "string",
});
