import type {
  Partition,
  PartitionStorage,
  Schema,
  SchemaProperty,
  TypedArray,
  TypedArrayConstructor,
} from "@phughesmcr/partitionedbuffer";

import type { StorageProxy } from "@/component/storage-proxy.ts";
import type { Entity, PackSlot, SlotIndex } from "@/entity/entity.ts";
import type { FieldDescriptor, FieldRaw, FieldValue } from "@/schema/field.ts";

export type { Partition, PartitionStorage, Schema, SchemaProperty, TypedArray, TypedArrayConstructor };

/**
 * The specification for a StorageProxy
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxySpec<T extends SchemaOrNull> = {
  /** Mark the actual storage slot as changed for this component. */
  markChanged(slot: SlotIndex): void;
  /** Validate a packed entity target against liveness and ownership. */
  has(entity: Entity): boolean;
  /** Pack a raw slot into its current entity handle. */
  packSlot?: PackSlot;
  /** The component storage of the StorageProxy */
  storage: ComponentStorage<T>;
  /** The capacity of the World */
  capacity: number;
};

/** A Schema or null (null = tag component) */
export type SchemaOrNull<T = unknown> = Schema<T> | null;

/** One component schema entry: a numeric typed-array column or a non-numeric `field.*` descriptor. */
export type ComponentFieldSpec = SchemaProperty | FieldDescriptor;

/** A component schema object whose entries may be numeric columns or `field.*` descriptors. */
export type FieldSchema<T> = {
  [K in keyof T]: ComponentFieldSpec;
};

/** Resolve the raw storage column type for one schema property definition. */
export type SchemaPropertyArray<T> = T extends FieldDescriptor ? FieldRaw<T> :
  T extends TypedArrayConstructor ? InstanceType<T> :
  T extends [infer Constructor extends TypedArrayConstructor, number] ? InstanceType<Constructor> :
  never;

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
export type ComponentValue<T> = T extends null ? never : {
  [K in keyof T]: T[K] extends FieldDescriptor ? FieldValue<T[K]> :
    T[K] extends SchemaProperty ? number :
    T[K] extends number ? T[K] & number :
    T[K];
};

/** Data read out of component storage: numbers for numeric columns, decoded values for `field.*` fields. */
export type ComponentData<T> = T extends null ? Record<never, number> : {
  [K in keyof T]: T[K] extends FieldDescriptor ? FieldValue<T[K]> :
    T[K] extends SchemaProperty | number ? number :
    T[K];
};

/**
 * World-local storage for one data component: numeric and lowered field columns live in the shared buffer;
 * string / object fields are slot-indexed JS arrays. All of them appear in `partitions`.
 */
export type ComponentStorage<T extends SchemaOrNull> = {
  /** Byte offset of the component's typed columns in the world buffer. */
  readonly byteOffset: number;
  /** Byte length of the component's typed columns in the world buffer. */
  readonly byteLength: number;
  /** Raw columns keyed by field name, indexed by storage slot. */
  readonly partitions: ComponentPartitions<T>;
  /** Raw unchecked read of one cell. */
  get(partition: keyof T, index: number): unknown;
  /** Raw unchecked write of one cell. */
  set(partition: keyof T, index: number, value: unknown): void;
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
