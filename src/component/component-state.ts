import { getPartitionByteSize, Partition, type PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_PARTITION_KEY } from "@/constants.ts";
import type { Entity, PackSlot } from "@/entity/entity.ts";
import { isFieldDescriptor } from "@/schema/field.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import type { ComponentStorage, SchemaOrNull, TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";
import { ComponentInstance } from "./component-instance.ts";
import {
  codecDefault,
  createFieldCodec,
  decodeFieldValue,
  type FieldCodec,
  isSideField,
  sideDefault,
  type SideField,
} from "./field-codec.ts";
import { SlotSet } from "./slot-set.ts";
import { createColumnWriters, StorageProxy } from "./storage-proxy.ts";

/** Sparse (capped) storage column; every column of one component shares a single slot -> row index. */
export type SparseColumn = TypedArray & {
  /** The packed rows, in the column's element type. */
  readonly dense: TypedArray;
  getEntity(entity: number): number | undefined;
  setEntity(entity: number, value: number): void;
  deleteEntity(entity: number): boolean;
};

/**
 * One registered component's world-local state: ownership, changed tracking, storage columns and staging scratch.
 * Rollback snapshots, world saves and storage writes all read this one type.
 * @internal
 */
export type ComponentState = {
  readonly instance: DynamicComponentInstance;
  /** Owner cap for this world, or `0` when uncapped. */
  readonly maxOwners: number;
  /** Owner slots in iteration order. */
  readonly owners: SlotSet;
  /** Slot -> `1` when owned; `null` until the first owner. The fast membership test for ownership. */
  ownerFlags: Uint8Array | null;
  /** The changed window: owner slots written since the last refresh. Always empty for tag components. */
  readonly changed: SlotSet;
  /** `true` when columns are capped (sparse) and rows must be mapped before a slot is written. */
  readonly usesSparseStorage: boolean;
  /** Dense and sparse partition keys in stable registration order. */
  readonly storageKeys: readonly string[];
  /** Parallel storage columns for `storageKeys`. */
  readonly storageColumns: readonly TypedArray[];
  /** One-element typed-array scratch buffers for value canonicalization, keyed by storage key. */
  readonly coercionScratch: Record<string, TypedArray>;
  /** Parallel scratch columns for `storageKeys` (avoids string-key lookup on write). */
  readonly coercionScratchColumns: readonly TypedArray[];
  /** Per typed column: the field codec for bool / enum / entity columns, `null` for numeric columns. */
  readonly storageCodecs: readonly (FieldCodec | null)[];
  /** Per typed column: the raw value a new owner starts at. */
  readonly storageDefaults: readonly number[];
  /** String / object field keys in declaration order. */
  readonly sideKeys: readonly string[];
  /** Slot-indexed JS arrays parallel to `sideKeys`. */
  readonly sideColumns: readonly unknown[][];
  /** Field descriptors parallel to `sideKeys`. */
  readonly sideFields: readonly SideField[];
  /** Side key -> position in `sideKeys`. */
  readonly sideIndex: Readonly<Record<string, number>>;
  /**
   * Validated side values staged for the next write, parallel to `sideKeys`. Each write path clears it once the
   * staged values are committed or discarded, so it never keeps objects alive.
   */
  readonly sideScratch: unknown[];
  /** Values for absent side fields of a new owner (default or `create()`), parallel to `sideKeys`. */
  readonly sideInitial: unknown[];
  /** Canonical entity liveness check for entity fields. */
  readonly isEntityActive: (entity: Entity) => boolean;
  /** `true` when a new owner needs a cap check, side staging or a sparse row before it is claimed. */
  readonly needsOwnerPreparation: boolean;
  /** `true` when any column is a `field.*` field (reads decode, removal releases side cells). */
  readonly hasFieldColumns: boolean;
  /** Monotonic revision for membership and value changes. */
  revision: number;
  /** World revision token assigned on the last change. */
  lastChangedRevision: number;
};

/** Manager callbacks a component's instance, proxy and writers close over. */
export type ComponentStateLinks = {
  /** Packs a live slot into an entity handle. */
  readonly packSlot: PackSlot;
  /** Canonical entity liveness check. */
  readonly isEntityActive: (entity: Entity) => boolean;
  /** Ownership check for a live entity handle. */
  readonly has: (entity: Entity) => boolean;
  /** Mark an owning entity changed. */
  readonly markChanged: (entity: Entity) => boolean;
  /** Mark a raw-written slot changed when it is an owner. */
  readonly markSlotChanged: (slot: number) => void;
  /** Current revision of the component. */
  readonly getRevision: () => number;
};

/**
 * Dense rows needed for a capped component's sparse storage, or `null` for dense (capacity-sized) storage.
 * A cap that can never bind (at or above world capacity) is stored densely, so it never over-allocates
 * and cannot be starved by stray raw writes.
 */
function getSparseRowCount(component: DynamicComponent, capacity: number): number | null {
  const maxOwners = component.maxOwners;
  return maxOwners === null || maxOwners >= capacity ? null : maxOwners;
}

/** Bytes a component's typed columns take in a world of `capacity`. */
export function getComponentStorageSize(component: DynamicComponent, capacity: number): number {
  const schema = component[$_PARTITION_KEY].schema;
  if (schema === null) return 0;
  return getPartitionByteSize(schema, getSparseRowCount(component, capacity) ?? capacity);
}

/** The component's own partition, or a world-sized copy when its owner cap exceeds world capacity. */
function getWorldPartition(component: DynamicComponent, capacity: number): DynamicComponent[typeof $_PARTITION_KEY] {
  const partition = component[$_PARTITION_KEY];
  const rows = getSparseRowCount(component, capacity);
  if (rows === partition.maxOwners) return partition;
  return new Partition({ name: component.name, schema: partition.schema, maxOwners: rows } as never);
}

/** Slot-indexed string / object columns for one component, plus the lookups its state needs. */
type SideColumns = {
  readonly keys: string[];
  readonly columns: unknown[][];
  readonly fields: SideField[];
  readonly index: Record<string, number>;
};

/** Build capacity-length side columns for a component's string / object fields. */
function createSideColumns(component: DynamicComponent, capacity: number): SideColumns {
  const keys: string[] = [];
  const columns: unknown[][] = [];
  const fields: SideField[] = [];
  const index: Record<string, number> = Object.create(null);
  const schema = component.schema as Record<string, unknown> | null;
  if (schema !== null) {
    for (const key of Object.keys(schema)) {
      const property = schema[key];
      if (!isFieldDescriptor(property) || !isSideField(property)) continue;
      index[key] = keys.length;
      keys.push(key);
      fields.push(property);
      columns.push(new Array<unknown>(capacity).fill(sideDefault(property)));
    }
  }
  return { keys, columns, fields, index };
}

/** Storage for a component whose only fields are string / object columns (its buffer partition is empty). */
function createSideOnlyStorage(partitions: Record<string, unknown[]>): ComponentStorage<SchemaOrNull> {
  return {
    byteOffset: 0,
    byteLength: 0,
    partitions: partitions as never,
  };
}

/**
 * Register `component` in `buffer` and build its world-local state and instance.
 * @param component - The component definition
 * @param id - The instance id (registration index)
 * @param capacity - World capacity
 * @param buffer - The world's partitioned buffer, sized for every component
 * @param links - Manager callbacks the instance, proxy and writers close over
 */
export function createComponentState(
  component: DynamicComponent,
  id: number,
  capacity: number,
  buffer: PartitionedBuffer,
  links: ComponentStateLinks,
): ComponentState {
  const maxOwners = component.maxOwners ?? 0;
  const partition = getWorldPartition(component, capacity);
  const bufferStorage = buffer.addPartition(partition);
  const coercionScratch: Record<string, TypedArray> = Object.create(null);
  const storageKeys: string[] = [];
  const storageColumns: TypedArray[] = [];
  const coercionScratchColumns: TypedArray[] = [];
  const storageCodecs: (FieldCodec | null)[] = [];
  const storageDefaults: number[] = [];
  const codecsByKey: Record<string, FieldCodec> = Object.create(null);
  const logicalSchema = component.schema as Record<string, unknown> | null;
  let usesSparseStorage = false;
  if (bufferStorage !== null) {
    const partitions = bufferStorage.partitions as Record<string, TypedArray>;
    const physicalSchema = partition.schema as Record<string, TypedArrayConstructor>;
    for (const key of Object.keys(partitions)) {
      const column = partitions[key]!;
      const scratchColumn = new physicalSchema[key]!(1);
      const codec = createFieldCodec(logicalSchema?.[key]);
      coercionScratch[key] = scratchColumn;
      storageKeys.push(key);
      storageColumns.push(column);
      coercionScratchColumns.push(scratchColumn);
      storageCodecs.push(codec);
      storageDefaults.push(codecDefault(codec));
      if (codec !== null) codecsByKey[key] = codec;
      if (!ArrayBuffer.isView(column)) usesSparseStorage = true;
    }
  }
  const side = createSideColumns(component, capacity);
  let storage = bufferStorage as ComponentStorage<SchemaOrNull> | null;
  if (side.keys.length > 0) {
    // Side columns join the typed columns in `partitions`, so `storage.partitions[key]` reaches every field.
    const partitions: Record<string, unknown[]> = storage === null ?
      {} :
      storage.partitions as unknown as Record<string, unknown[]>;
    for (let i = 0; i < side.keys.length; i++) partitions[side.keys[i]!] = side.columns[i]!;
    if (storage === null) storage = createSideOnlyStorage(partitions);
  }
  const hasCodecs = storageCodecs.some((codec) => codec !== null);
  const sideFieldsByKey: Record<string, SideField> = Object.create(null);
  for (let i = 0; i < side.keys.length; i++) sideFieldsByKey[side.keys[i]!] = side.fields[i]!;
  const { isEntityActive, packSlot } = links;
  const decode = hasCodecs ?
    (key: string, raw: unknown): unknown => {
      const codec = codecsByKey[key];
      return codec === undefined ? raw : decodeFieldValue(codec, raw as number, isEntityActive);
    } :
    undefined;
  const writers = storage === null ? null : createColumnWriters({
    storage,
    componentName: component.name,
    coercionScratch,
    codecs: codecsByKey,
    sideFields: sideFieldsByKey,
    isEntityActive,
    markChanged: links.markSlotChanged,
  });
  const proxy = storage === null ? null : new StorageProxy({
    storage,
    writers: writers!,
    codecs: codecsByKey,
    isEntityActive,
    has: links.has,
    packSlot,
    capacity,
  });
  const instance = new ComponentInstance({
    id,
    has: links.has,
    markChanged: links.markChanged,
    proxy,
    storage,
    writers,
    capacity,
    type: component,
    getRevision: links.getRevision,
    decode,
  } as never) as DynamicComponentInstance;
  // Owner and changed lists hold at most the cap (or world capacity when uncapped).
  const listCapacity = maxOwners === 0 ? capacity : Math.min(maxOwners, capacity);
  return {
    instance,
    maxOwners,
    owners: new SlotSet(capacity, listCapacity, packSlot),
    ownerFlags: null,
    changed: new SlotSet(capacity, listCapacity, packSlot),
    usesSparseStorage,
    storageKeys,
    storageColumns,
    coercionScratch,
    coercionScratchColumns,
    storageCodecs,
    storageDefaults,
    sideKeys: side.keys,
    sideColumns: side.columns,
    sideFields: side.fields,
    sideIndex: side.index,
    sideScratch: new Array<unknown>(side.keys.length).fill(undefined),
    sideInitial: new Array<unknown>(side.keys.length).fill(undefined),
    isEntityActive,
    needsOwnerPreparation: maxOwners !== 0 || side.keys.length > 0 || usesSparseStorage,
    hasFieldColumns: hasCodecs || side.keys.length > 0,
    revision: 0,
    lastChangedRevision: 0,
  };
}
