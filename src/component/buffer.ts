/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ONE_BYTE } from "../constants.js";
import { sparseFacade } from "../utils/sparse-facade.js";
import { multipleOf4, TypedArrayConstructor } from "../utils/utils.js";
import type { Component } from "./component.js";
import type { SchemaStorage } from "./schema.js";

interface ComponentBufferSpec {
  capacity: number;
  components: Component<unknown>[];
}

interface ComponentBufferPartitionerSpec {
  buffer: ArrayBuffer;
  capacity: number;
}

/** <T>(c: Component<T>) => { [schema_key: keyof T]: TypedArray } */
export type ComponentBufferPartitioner = <T>(component: Component<T>) => SchemaStorage<T> | undefined;

/** Calculate the total required storage space for all component schemas */
function getComponentSize(capacity: number, components: Component<unknown>[]) {
  const componentSum = <T>(total: number, component: Component<T>): number => {
    const { size = 0 } = component;
    if (!size || size <= 0) return total;
    return total + size * capacity;
  };
  return components.reduce(componentSum, 0);
}

/**
 * Create a properly sized ArrayBuffer to hold all a world's component's data.
 * @param spec The component buffer's specification object
 * @param spec.capacity The world's entity capacity
 * @param spec.components The components which the buffer will contain
 */
export function createComponentBuffer(spec: ComponentBufferSpec): ArrayBuffer {
  const { capacity, components } = spec;
  const totalSize = getComponentSize(capacity, components);
  return new ArrayBuffer(ONE_BYTE * Math.ceil(totalSize / ONE_BYTE));
}

/**
 * Creates a function which allows for the creation of component storage partitions.
 * @param spec the partitioner's specification object
 * @param spec.buffer the buffer to partition
 * @param spec.capacity the world's entity capacity
 * @returns <T>(c: Component<T>) => { [schema_key: keyof T]: TypedArray };
 */
export function createComponentBufferPartitioner(spec: ComponentBufferPartitionerSpec): ComponentBufferPartitioner {
  const { buffer, capacity } = spec;
  let bufferOffset = 0;
  let full = false;

  return <T>(component: Component<T>): SchemaStorage<T> | undefined => {
    if (full === true) throw new Error("ArrayBuffer is full!");
    const { maxEntities, schema, size = 0 } = component;
    if (!schema || size <= 0) return; // bail early if component is a tag
    const requiredSize = maxEntities ?? capacity;

    if (bufferOffset + size * requiredSize > buffer.byteLength) {
      throw new Error("Component will not fit inside the buffer!");
    }

    let componentOffset = 0;
    const partition = (
      res: SchemaStorage<T>,
      [key, value]: [keyof T, TypedArrayConstructor | [TypedArrayConstructor, number]],
    ) => {
      let typedArray = value as TypedArrayConstructor;
      let initialValue = 0;
      if (Array.isArray(value)) {
        [typedArray, initialValue] = value;
      }
      const dense = new typedArray(buffer, bufferOffset + componentOffset, requiredSize);
      res[key] = maxEntities === null ? dense : sparseFacade(dense);
      if (initialValue !== 0) res[key].fill(initialValue as never);
      componentOffset = alignBytes(componentOffset + typedArray.BYTES_PER_ELEMENT * requiredSize);
      return res;
    };

    const data = Object.entries(schema) as [keyof T, TypedArrayConstructor][];
    const storage = data.reduce(partition, {} as SchemaStorage<T>);

    bufferOffset += componentOffset;
    if (bufferOffset > buffer.byteLength) full = true;

    return storage;
  };
}
