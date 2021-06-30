/**
 * @name        Schema
 * @description Schemas determine the acceptable shape of component properties
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 * @example
 *              import { Schema, Types } from './schema';
 *
 *              // first, define the shape of the schema:
 *
 *              interface Point {
 *                x: Int32Array,
 *                y: Int32Array,
 *              }
 *
 *              // then, define the schema object:
 *
 *              const Vec2: Schema<Point> = {
 *                // properties can be a SchemaProperty object from the `Types` object:
 *                x: Types.i32,
 *
 *                // or properties can p
 *                x: {
 *                  type: Types.i32,  // get the type from the Types object to avoid undefined behavior
 *                  init: 0,       // define a default property to initialize entities with,
 *                                    // if no default is provided, the default from the type is used
 *                },
 *              }
 *
 *              // the schema can then be used in component creation:
 *
 *              const position = createComponent({
 *                name: "position",
 *                schema: Vec2,
 *              });
 *
 *              const velocity = createComponent({
 *                name: "velocity",
 *                schema: Vec2,
 *              });
 */
"use strict";

import { isObject } from "../utils/objects";
import {
  cloneArray,
  cloneMap,
  cloneObject,
  cloneSet,
  cloneTypedArray,
  cloneValue,
  copyArray,
  copyMap,
  copyObject,
  copySet,
  copyTypedArray,
  copyValue,
  TypeCloneFunction,
  TypeCopyFunction,
  TypedArray,
} from "../utils/types";

/**
 * Test if a given object is a valid component schema
 * @param schema the object to test
 * @returns true if the object is a valid schema
 */
export function isValidSchema<T>(schema: unknown): schema is Schema<T> {
  return Boolean(isObject(schema) && Object.keys(schema).length > 0);
}

export interface SchemaProperty<T, D> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (...args: any[]) => T;
  init: D;
  clone: TypeCloneFunction<T>;
  copy: TypeCopyFunction<T>;
}

export type Schema<T> = {
  [K in keyof T]:
    | SchemaProperty<T[K], T[K]>
    | {
        type: SchemaProperty<T[K], T[K]>;
        default?: T[K];
      };
};

export type ArrayPropType<T> = SchemaProperty<Array<T>, []>;
export type BooleanPropType = SchemaProperty<boolean, boolean>;
export type JSONPropType = SchemaProperty<unknown, unknown | null>;
export type MapPropType<T, D> = SchemaProperty<Map<T, D>, Map<T, D>>;
export type NumberPropType = SchemaProperty<number, number>;
export type ObjectPropType<T extends Record<string, unknown>> = SchemaProperty<T, T>;
export type RefPropType<T> = SchemaProperty<T, undefined>;
export type SetPropType<T> = SchemaProperty<Set<T>, Set<T>>;
export type StringPropType = SchemaProperty<string, string>;
export type TypedArrayType<T extends TypedArray> = SchemaProperty<T, T>;

/**  */
export const ArrayType: ArrayPropType<unknown> = {
  copy: copyArray,
  clone: cloneArray,
  init: [],
  create: function (length?: number): unknown[] {
    return new Array(length) as unknown[];
  },
};

/**  */
export const BooleanType: BooleanPropType = {
  copy: copyValue,
  clone: cloneValue,
  init: false,
  create: function (value?: unknown): boolean {
    return Boolean(value);
  },
};

/**  */
export const MapType: MapPropType<unknown, unknown> = {
  copy: copyMap,
  clone: cloneMap,
  init: new Map(),
  create: function <K, V>(entries?: [K, V][] | null | undefined): Map<K, V> {
    return new Map(entries);
  },
};

/**  */
export const NumberType: NumberPropType = {
  copy: copyValue,
  clone: cloneValue,
  init: 0,
  create: function (value?: unknown): number {
    return Number(value || this.init);
  },
};

/**  */
export const JSONType: JSONPropType = {
  copy: copyValue,
  clone: cloneValue,
  init: null,
  create: function (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown {
    return JSON.parse(text, reviver);
  },
};

/**  */
export const ObjectType: ObjectPropType<Record<string, unknown>> = {
  copy: copyObject,
  clone: cloneObject,
  init: {},
  create: function (
    prototype: unknown | null = Object.prototype,
    properties?: PropertyDescriptorMap
  ): Record<string, unknown> {
    return Object.create(prototype as Record<string, unknown> | null, properties ?? {}) as Record<string, unknown>;
  },
};

/**  */
export const RefType: RefPropType<unknown> = {
  copy: copyValue,
  clone: cloneValue,
  init: undefined,
  create: function (ref: unknown): unknown {
    return ref;
  },
};

/**  */
export const SetType: SetPropType<unknown> = {
  copy: copySet,
  clone: cloneSet,
  init: new Set(),
  create: function <T>(values?: T[] | null): Set<T> {
    return new Set(values);
  },
};

/**  */
export const StringType: StringPropType = {
  copy: copyValue,
  clone: cloneValue,
  init: "",
  create: function (value?: unknown): string {
    return String(value);
  },
};

/**  */
export const i8Type: TypedArrayType<Int8Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Int8Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int8Array {
    return new Int8Array(buffer, byteOffset, length);
  },
};

/**  */
export const u8Type: TypedArrayType<Uint8Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Uint8Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8Array {
    return new Uint8Array(buffer, byteOffset, length);
  },
};

/**  */
export const u8cType: TypedArrayType<Uint8ClampedArray> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Uint8ClampedArray(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8ClampedArray {
    return new Uint8ClampedArray(buffer, byteOffset, length);
  },
};

/**  */
export const i16Type: TypedArrayType<Int16Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Int16Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int16Array {
    return new Int16Array(buffer, byteOffset, length);
  },
};

/**  */
export const u16Type: TypedArrayType<Uint16Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Uint16Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint16Array {
    return new Uint16Array(buffer, byteOffset, length);
  },
};

/**  */
export const i32Type: TypedArrayType<Int32Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Int32Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int32Array {
    return new Int32Array(buffer, byteOffset, length);
  },
};

/**  */
export const u32Type: TypedArrayType<Uint32Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Uint32Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint32Array {
    return new Uint32Array(buffer, byteOffset, length);
  },
};

/**  */
export const f32Type: TypedArrayType<Float32Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Float32Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float32Array {
    return new Float32Array(buffer, byteOffset, length);
  },
};

/**  */
export const f64Type: TypedArrayType<Float64Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new Float64Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float64Array {
    return new Float64Array(buffer, byteOffset, length);
  },
};

/**  */
export const i64Type: TypedArrayType<BigInt64Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new BigInt64Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): BigInt64Array {
    return new BigInt64Array(buffer, byteOffset, length);
  },
};

/**  */
export const u64Type: TypedArrayType<BigUint64Array> = {
  copy: copyTypedArray,
  clone: cloneTypedArray,
  init: new BigUint64Array(),
  create: function (buffer: ArrayBufferLike, byteOffset?: number, length?: number): BigUint64Array {
    return new BigUint64Array(buffer, byteOffset, length);
  },
};

/**  */
export const Types: {
  Array: ArrayPropType<unknown>;
  Boolean: BooleanPropType;
  JSON: JSONPropType;
  Map: MapPropType<unknown, unknown>;
  Number: NumberPropType;
  Object: ObjectPropType<Record<string, unknown>>;
  Ref: RefPropType<unknown>;
  Set: SetPropType<unknown>;
  String: StringPropType;
  i8: TypedArrayType<Int8Array>;
  u8: TypedArrayType<Uint8Array>;
  u8c: TypedArrayType<Uint8ClampedArray>;
  i16: TypedArrayType<Int16Array>;
  u16: TypedArrayType<Uint16Array>;
  i32: TypedArrayType<Int32Array>;
  u32: TypedArrayType<Uint32Array>;
  f32: TypedArrayType<Float32Array>;
  f64: TypedArrayType<Float64Array>;
  i64: TypedArrayType<BigInt64Array>;
  u64: TypedArrayType<BigUint64Array>;
} = {
  Array: ArrayType,
  Boolean: BooleanType,
  JSON: JSONType,
  Map: MapType,
  Number: NumberType,
  Object: ObjectType,
  Ref: RefType,
  Set: SetType,
  String: StringType,
  i8: i8Type,
  u8: u8Type,
  u8c: u8cType,
  i16: i16Type,
  u16: u16Type,
  i32: i32Type,
  u32: u32Type,
  f32: f32Type,
  f64: f64Type,
  i64: i64Type,
  u64: u64Type,
};
