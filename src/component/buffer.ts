/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { sparseFacade } from "./sparse-facade.js";
import type { Component } from "./component.js";
import type { Schema, SchemaStorage } from "./schema.js";
import type { TypedArrayConstructor } from "../utils/utils.js";

export interface ComponentBufferSpec {
  /** The maximum number of Entities in the World */
  capacity: number;
  /** An array of Components to partition to buffer for */
  components: Component<any>[];
}

/** Serialized component partition property object */
export type PartitionProperty = {
  [propertyName: string]: [offset: number, typedArrayType: string, maxEntities: number | null];
};

/** Serialized component buffer partition object */
export type PartitionsObject = {
  [componentName: string]: PartitionProperty;
};

export interface ComponentBufferData {
  /** The ArrayBuffer as a string */
  buffer: string;
  /** The maximum number of Entities in the World */
  capacity: number;
  /** Map of components and the byteOffset of their schema properties */
  partitions: PartitionsObject;
}

/**
 * Calculate the total required storage space for all component schemas
 * @param capacity The maximum number of Entities in the World
 * @param components An array of Components to create partitions for
 * @returns The required ArrayBuffer size in bytes
 */
export function getTotalStorageSize(capacity: number, components: Component<any>[]): number {
  return components.reduce(<T extends Schema<T>>(total: number, component: Component<T>): number => {
    const { size } = component;
    if (!size || !isFinite(size) || size < 0) return total;
    return total + size * capacity;
  }, 0);
}

/**
 * Partitions the ComponentBuffer into individual TypedArrays for each Component
 * @param buffer The ComponentBuffer to partition
 * @param capacity The maximum number of Entities in the World
 * @param components An array of Components to create partitions for
 * @returns A map of SchemaStorage objects keyed by the Component object
 */
export function partitionComponentBuffer(
  buffer: ComponentBuffer,
  capacity: number,
  components: Component<any>[],
): Map<Component<any>, SchemaStorage<any>> {
  const partitions = new Map<Component<any>, SchemaStorage<any>>();
  let byteOffset = 0;
  for (const component of components) {
    const { maxEntities, schema } = component;
    // Tags don't need partitions
    if (!schema) return partitions;
    // maxEntities should always be less than capacity
    const requiredSize = maxEntities ?? capacity;
    // the result in partition object
    const partition = {} as SchemaStorage<any>;
    // loop though each item in the schema and create a new PartitionProperty object
    for (const [key, value] of Object.entries(schema)) {
      // `value` can be a TypedArrayConstructor, or [TypedArrayConstructor, initialValue]
      let typedArrayConstructor = value as TypedArrayConstructor;
      let initialValue = 0;
      if (Array.isArray(value)) [typedArrayConstructor, initialValue] = value as [TypedArrayConstructor, number];
      // Create the underlying TypedArray storage
      const dense = new typedArrayConstructor(buffer, byteOffset, requiredSize);
      partition[key] = maxEntities === null ? dense : sparseFacade(dense);
      partition[key]?.fill(initialValue as never);
      // increment the global ArrayBuffer byteOffset
      byteOffset += typedArrayConstructor.BYTES_PER_ELEMENT * requiredSize;
    }
    partitions.set(component, partition);
  }
  return partitions;
}

/**
 * Serialize a ComponentBuffer object into a stringify-able object
 * @param buffer The ComponentBuffer to serialize
 * @returns A new ComponentBufferData object
 */
export function serializeComponentBuffer(buffer: ComponentBuffer): ComponentBufferData {
  const { capacity, partitions } = buffer;

  // Reduce the partitions to { componentName: { propertyName: byteOffset, ... }, ... }
  const parts: PartitionsObject = {};
  for (const [component, storage] of partitions) {
    const props: PartitionProperty = {};
    for (const [name, arr] of Object.entries(storage)) {
      props[name] = [arr.byteOffset, arr.constructor.name, component.maxEntities];
    }
    parts[component.name] = props;
  }

  return {
    buffer: new TextDecoder().decode(buffer),
    capacity,
    partitions: parts,
  };
}

export class ComponentBuffer extends ArrayBuffer {
  /** Maximum number of entities in the world */
  readonly capacity: number;

  /** Components and their respective TypedArray storage */
  readonly partitions: Map<Component<any>, SchemaStorage<any>> = new Map();

  /**
   * Create a properly sized ArrayBuffer to hold all a world's component's data.
   * @param spec The component buffer's specification object
   * @param spec.capacity The world's entity capacity
   * @param spec.components The components which the buffer will contain
   */
  constructor(spec: ComponentBufferSpec) {
    const { capacity, components } = spec;
    super(getTotalStorageSize(capacity, components));
    this.capacity = capacity;
    this.partitions = partitionComponentBuffer(this, capacity, components);
  }
}
