/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ONE_BYTE } from "../constants.js";
import { TypedArray, TypedArrayConstructor } from "../utils.js";
import { Component } from "./component.js";
import { SchemaStorage } from "./schema.js";

export interface ComponentBufferSpec {
  components: Component<unknown>[];
  entityCapacity: number;
}

export interface ComponentBufferPartitionerSpec {
  buffer: ArrayBuffer;
  entityCapacity: number;
}

/** <T>(c: Component<T>) => { [schema_key: keyof T]: TypedArray } */
export type ComponentBufferPartitioner = <T>(component: Component<T>) => SchemaStorage<T> | undefined;

/** Calculate the total required storage space for all component schemas */
function getComponentSize(entityCapacity: number, components: Component<unknown>[]) {
  function componentSum<T>(total: number, component: Component<T>): number {
    const { size = 0 } = component;
    if (!size || size <= 0) return total;
    return total + size * entityCapacity;
  }
  return components.reduce(componentSum, 0);
}

/**
 * Create a properly sized ArrayBuffer to hold all a world's component's data.
 * @param spec The component buffer's specification object
 * @param spec.entityCapacity The world's entity capacity
 * @param spec.components The components which the buffer will contain
 */
export function createComponentBuffer(spec: ComponentBufferSpec): ArrayBuffer {
  const { entityCapacity, components } = spec;
  const totalSize = getComponentSize(entityCapacity, components);
  return new ArrayBuffer(ONE_BYTE * Math.ceil(totalSize / ONE_BYTE));
}

/**
 * Creates a function which allows for the creation of component storage partitions.
 * @param spec the partitioner's specification object
 * @param spec.buffer the buffer to partition
 * @param spec.entityCapacity the world's entity capacity
 * @returns <T>(c: Component<T>) => { [schema_key: keyof T]: TypedArray };
 */
export function createComponentBufferPartitioner(spec: ComponentBufferPartitionerSpec): ComponentBufferPartitioner {
  const { buffer, entityCapacity } = spec;
  let bufferOffset = 0;
  let full = false;

  return function partitionComponentBuffer<T>(component: Component<T>): SchemaStorage<T> | undefined {
    if (full === true) throw new Error("ArrayBuffer is full!");
    const { schema, size = 0 } = component;
    if (!size || size <= 0) return; // bail early if component is a tag
    if (bufferOffset + size * entityCapacity > buffer.byteLength) {
      throw new Error("Component will not fit inside the buffer!");
    }

    let componentOffset = 0;
    function partition(res: Record<keyof T, TypedArray>, [key, TypedArray]: [keyof T, TypedArrayConstructor]) {
      res[key] = new TypedArray(buffer, bufferOffset + componentOffset, entityCapacity);
      componentOffset += TypedArray.BYTES_PER_ELEMENT * entityCapacity;
      return res;
    }

    const data = Object.entries(schema as Record<keyof T, TypedArrayConstructor>) as [keyof T, TypedArrayConstructor][];
    const storage = data.reduce(partition, {} as Record<keyof T, TypedArray>);

    bufferOffset += componentOffset;
    if (bufferOffset > buffer.byteLength) full = true;

    return storage;
  };
}
