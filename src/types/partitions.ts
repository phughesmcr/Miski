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
  TypedArray,
  TypedArrayConstructor,
} from "@phughesmcr/partitionedbuffer";

import type { Entity } from "@/entity/entity-id.ts";
import type { StorageProxy } from "@/component/storage-proxy.ts";

export type { Partition, PartitionStorage, Schema, TypedArray, TypedArrayConstructor };

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
 * A StorageProxy with properties
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxyWithProperties<T extends SchemaOrNull> =
  /** The StorageProxy */
  & StorageProxy<T>
  & {
    /** The properties of the StorageProxy */
    [key in keyof T]: number;
  };
