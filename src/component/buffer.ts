/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ONE_BYTE } from "../constants.js";
import { sparseFacade } from "../utils/sparse-facade.js";
import { multipleOf4, TypedArrayConstructor } from "../utils/utils.js";
import { Component } from "./component.js";
import { Schema, SchemaStorage } from "./schema.js";

interface ComponentBufferSpec {
  capacity: number;
  components: Component<any>[];
}

export class ComponentBuffer extends ArrayBuffer {
  /** Calculate the total required storage space for all component schemas */
  static calculateSize(capacity: number, components: Component<any>[]): number {
    const componentSum = <T extends Schema<T>>(total: number, component: Component<T>): number => {
      const { size } = component;
      if (!size || size <= 0) return total;
      return total + size * capacity;
    };
    return components.reduce(componentSum, 0);
  }

  bufferOffset: number;
  capacity: number;

  /**
   * Create a properly sized ArrayBuffer to hold all a world's component's data.
   * @param spec The component buffer's specification object
   * @param spec.capacity The world's entity capacity
   * @param spec.components The components which the buffer will contain
   */
  constructor(spec: ComponentBufferSpec) {
    const { capacity, components } = spec;
    const totalSize = ComponentBuffer.calculateSize(capacity, components);
    super(ONE_BYTE * Math.ceil(totalSize / ONE_BYTE));
    this.bufferOffset = 0;
    this.capacity = capacity;
  }

  get isFull(): boolean {
    return this.bufferOffset > this.byteLength;
  }

  partition<T extends Schema<T>>(component: Component<T>): SchemaStorage<T> | undefined {
    if (this.isFull === true) throw new Error("ArrayBuffer is full!");
    const { maxEntities, schema, size = 0 } = component;
    if (!schema || size <= 0) return; // bail early if component is a tag
    const requiredSize = maxEntities ?? this.capacity;

    if (this.bufferOffset + size * requiredSize > this.byteLength) {
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
      const dense = new typedArray(this, this.bufferOffset + componentOffset, requiredSize);
      res[key] = maxEntities === null ? dense : sparseFacade(dense);
      if (initialValue !== 0) res[key].fill(initialValue as never);
      componentOffset = multipleOf4(componentOffset + typedArray.BYTES_PER_ELEMENT * requiredSize);
      return res;
    };

    const data = Object.entries(schema) as [keyof T, TypedArrayConstructor][];
    const storage = data.reduce(partition, {} as SchemaStorage<T>);

    this.bufferOffset += componentOffset;

    return storage;
  }
}
