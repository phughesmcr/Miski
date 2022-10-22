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
      return total + size * capacity;
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
        if (Array.isArray(value)) [typedArrayConstructor, initialValue] = value as [TypedArrayConstructor, number];
        const dense = new typedArrayConstructor(buffer, offset, requiredSize);
        storage[key as keyof T] = maxEntities === null ? dense : sparseFacade(dense);
        storage[key as keyof T].fill(initialValue as never);
        offset += typedArrayConstructor.BYTES_PER_ELEMENT * requiredSize;
      });
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

export class DynamicBuffer {
  /** The underlying storage buffer */
  buffer: ArrayBuffer;

  /** Maximum number of in the world */
  readonly capacity: number;

  /** Components and their respective TypedArray storage */
  readonly map: Map<Component<any>, SchemaStorage<any>>;

  /** The current offset of the buffer */
  offset: number;

  /**
   * Component property storage
   * @param capacity The maximum number of entities in the world
   */
  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new ArrayBuffer(capacity);
    this.map = new Map();
    this.offset = 0;
  }

  addComponent<T extends Schema<T>>(component: Component<T>): DynamicBuffer {
    if (this.map.has(component)) return this;

    const { maxEntities, schema, size } = component;
    if (!schema) return this;

    // Resize and replace the buffer
    const requiredSize = maxEntities ?? this.capacity;
    const buffer = new ArrayBuffer(this.buffer.byteLength + requiredSize * size);
    new Uint8Array(buffer).set(new Uint8Array(this.buffer));
    this.buffer = buffer;

    // Create storage for each property
    const storage = {} as Record<keyof T, TypedArray>;
    Object.entries(schema).forEach(([key, value]) => {
      let typedArrayConstructor = value as TypedArrayConstructor;
      let initialValue = 0;
      if (Array.isArray(value)) [typedArrayConstructor, initialValue] = value as [TypedArrayConstructor, number];
      const dense = new typedArrayConstructor(buffer, this.offset, requiredSize);
      storage[key as keyof T] = maxEntities === null ? dense : sparseFacade(dense);
      storage[key as keyof T].fill(initialValue as never);
      this.offset += typedArrayConstructor.BYTES_PER_ELEMENT * requiredSize;
    });

    this.map.set(component, storage);

    return this;
  }

  removeComponent<T extends Schema<T>>(component: Component<T>): DynamicBuffer {
    const storage = this.map.get(component) as SchemaStorage<T>;
    if (!storage) return this;

    const { maxEntities, size } = component;

    // Get the starting offset position for the component
    const offset = Object.values(storage).reduce((res: number, arr) => {
      const { byteOffset } = arr as TypedArray;
      return Math.min(res, byteOffset);
    }, Number.POSITIVE_INFINITY);

    // Resize and replace the buffer
    const requiredSize = maxEntities ?? this.capacity;
    const totalSize = requiredSize * size;
    const buffer = new ArrayBuffer(this.buffer.byteLength - totalSize);
    const tmp = new Uint8Array(buffer);
    tmp.set(new Uint8Array(this.buffer, 0, offset));
    tmp.set(new Uint8Array(this.buffer, offset + totalSize));
    this.buffer = buffer;

    // Nudge all remaining components back (maps maintain set order)
    let after = false;
    [...this.map.entries()].forEach(([c, s]) => {
      if (after) {
        Object.entries(s).forEach(([k, v]) => {
          const { byteLength, byteOffset } = v;
          const Ctr = (v.constructor ??
            (Object.getPrototypeOf(v) as Record<string, unknown>).constructor) as TypedArrayConstructor;
          const a = new Ctr(buffer, byteOffset - totalSize, byteLength);
          s[k] = a;
        });
      }
      if (c === component) after = true;
    });

    return this;
  }
}
