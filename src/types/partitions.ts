/**
 * @module      types/partitions
 * @description Partition and schema type definitions.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type {
  Partition,
  PartitionStorage,
  Schema,
  SchemaProperty,
  TypedArray,
  TypedArrayConstructor,
} from "@phughesmcr/partitionedbuffer";

import type { StorageProxy } from "@/component/storage-proxy.ts";
import type { Entity } from "@/entity/entity-id.ts";

export type { Partition, PartitionStorage, Schema, SchemaProperty, TypedArray, TypedArrayConstructor };

/**
 * The specification for a StorageProxy
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxySpec<T> = {
  /** Mark the current entity as changed for this component. */
  markChanged(entity: Entity): void;
  /** The Partition data of the StorageProxy */
  storage: PartitionStorage<T>;
  /** The capacity of the World */
  capacity: number;
};

/** A Schema or null (null = tag component) */
export type SchemaOrNull<T = unknown> = Schema<T> | null;

/** Resolve the typed-array view type for one schema property definition. */
export type SchemaPropertyArray<T> = T extends TypedArrayConstructor ? InstanceType<T> :
  T extends [infer Constructor extends TypedArrayConstructor, number] ? InstanceType<Constructor> :
  never;

/** Typed-array partition views for a component schema */
export type SchemaPartitions<T extends Schema<T>> = {
  [K in keyof T]: SchemaPropertyArray<T[K]>;
};

/**
 * Typed-array partition views keyed by a component's schema.
 *
 * When the component's generic parameter is constructor-shaped
 * (e.g. `{ x: Float32ArrayConstructor }`) each partition resolves to the exact
 * typed-array type. When it is value-shaped (e.g. `{ x: number }`) the concrete
 * constructor is not recoverable at the type level, so each partition is
 * exposed as the general {@link TypedArray}. Tag components (`null` schema)
 * have no partitions.
 */
export type ComponentPartitions<T extends SchemaOrNull> = T extends null ? null : {
  readonly [K in keyof T]: [SchemaPropertyArray<T[K]>] extends [never] ? TypedArray : SchemaPropertyArray<T[K]>;
};

/** The public write/proxy value shape for a component. */
export type ComponentValue<T> = T extends null ? Record<never, number> : {
  [K in keyof T]: T[K] extends SchemaProperty ? number : T[K] & number;
};

/** Numeric data read out of component storage. */
export type ComponentData<T> = T extends null ? Record<never, number> : {
  [K in keyof T]: number;
};

/** Compatibility alias for component write/proxy values. */
export type SchemaValues<T> = ComponentValue<T>;

/**
 * A StorageProxy with properties
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxyWithProperties<T extends SchemaOrNull> =
  /** The StorageProxy */
  & StorageProxy<T>
  & {
    /** The properties of the StorageProxy */
    [key in keyof T]: key extends keyof ComponentValue<T> ? ComponentValue<T>[key] : never;
  };
