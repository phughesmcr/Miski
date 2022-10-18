/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { sparseFacade } from "../utils/sparse-facade.js";
import type { Component } from "./component.js";
import type { Schema, SchemaStorage } from "./schema.js";
import type { TypedArray, TypedArrayConstructor } from "../utils/utils.js";

interface ComponentBufferSpec {
  capacity: number;
  components: Component<any>[];
}

export class ComponentBuffer extends ArrayBuffer {
  /**
   * @private
   * Calculate the total required storage space for all component schemas
   */
  private static calculateSize(capacity: number, components: Component<any>[]): number {
    return components.reduce((total: number, component: Component<any>): number => {
      const { size } = component;
      if (!size || size < 0) return total;
      return total + (size * capacity);
    }, 0);
  }

  /**
   * @private
   * Partitions the ComponentBuffer into individual TypedArrays for each Component
   */
  private static partition(buffer: ComponentBuffer, capacity: number, components: Component<any>[]) {
    let offset = 0;
    components.forEach(<T extends Schema<T>>(component: Component<T>) => {
      const { maxEntities, schema } = component;
      if (!schema) return;
      const storage = {} as Record<keyof T, TypedArray>;
      const requiredSize = maxEntities ?? capacity;
      Object.entries(schema).forEach(([key, value]) => {
        let typedArrayConstructor = value as TypedArrayConstructor;
        let initialValue = 0;
        if (Array.isArray(value)) [typedArrayConstructor, initialValue] = value;
        const dense = new typedArrayConstructor(buffer, offset, requiredSize);
        storage[key as keyof T] = maxEntities === null ? dense : sparseFacade(dense);
        storage[key as keyof T].fill(initialValue as never);
        offset += (typedArrayConstructor.BYTES_PER_ELEMENT * requiredSize);
      })
      buffer.map.set(component, storage);
    });
    return buffer;
  }

  /** Maximum number of in the world */
  readonly capacity: number;

  /** Components and their respective TypedArray storage */
  readonly map: Map<Component<any>, SchemaStorage<any>> = new Map();

  /**
   * Create a properly sized ArrayBuffer to hold all a world's component's data.
   * @param spec The component buffer's specification object
   * @param spec.capacity The world's entity capacity
   * @param spec.components The components which the buffer will contain
   */
  constructor(spec: ComponentBufferSpec) {
    const { capacity, components } = spec;
    super(ComponentBuffer.calculateSize(capacity, components));
    ComponentBuffer.partition(this, capacity, components);
    this.capacity = capacity;
  }
}
