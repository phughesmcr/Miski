/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { sparseFacade } from "./sparse-facade.js";
import { TypedArray, TypedArrayConstructor } from "../utils/utils.js";
import { Component } from "./component.js";
import { SchemaStorage, Schema } from "./schema.js";

export class DynamicBuffer {
  /** The underlying storage buffer */
  buffer: ArrayBuffer;

  /** Maximum number of in the world */
  readonly capacity: number;

  /** Components and their respective TypedArray storage */
  readonly map: Map<Component<any>, SchemaStorage<any>>;

  /** The maximum number of components registered at once */
  readonly maxComponents: number;

  /** The current offset of the buffer */
  offset: number;

  /**
   * Component property storage.
   * @param capacity The maximum number of entities in the world.
   * @param maxComponents The maximum number of components registered at once.
   */
  constructor(capacity: number, maxComponents: number) {
    this.capacity = capacity;
    this.buffer = new ArrayBuffer(capacity * maxComponents * 8);
    this.map = new Map();
    this.maxComponents = maxComponents;
    this.offset = 0;
  }

  addComponent<T extends Schema<T>>(component: Component<T>): SchemaStorage<T> | null {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (this.map.has(component)) return this.map.get(component)!;

    const { maxEntities, schema, size } = component;
    if (!schema) return null;
    if (this.map.size >= this.maxComponents) return null;

    const requiredSize = maxEntities ?? this.capacity;
    if (this.offset + requiredSize * size >= this.buffer.byteLength) {
      // Resize and replace the buffer
      const buffer = new ArrayBuffer(this.offset + requiredSize * size);
      new Uint8Array(buffer).set(new Uint8Array(this.buffer));
      this.buffer = buffer;
    }

    // Create storage for each property
    const storage = {} as Record<keyof T, TypedArray>;
    Object.entries(schema).forEach(([key, value]) => {
      let typedArrayConstructor = value as TypedArrayConstructor;
      let initialValue = 0;
      if (Array.isArray(value)) [typedArrayConstructor, initialValue] = value as [TypedArrayConstructor, number];
      const dense = new typedArrayConstructor(this.buffer, this.offset, requiredSize);
      storage[key as keyof T] = maxEntities === null ? dense : sparseFacade(dense);
      storage[key as keyof T].fill(initialValue as never);
      this.offset += typedArrayConstructor.BYTES_PER_ELEMENT * requiredSize;
    });

    this.map.set(component, storage);

    return storage;
  }

  removeComponent<T extends Schema<T>>(component: Component<T>): boolean {
    const storage = this.map.get(component);
    if (!storage) return false;

    const { maxEntities, size } = component;

    // Get the starting offset position for the component
    const offset = Object.values(storage).reduce((res: number, arr: TypedArray) => {
      const { byteOffset } = arr;
      return Math.min(res, byteOffset);
    }, Number.POSITIVE_INFINITY);

    // Resize and replace the buffer
    const totalSize = (maxEntities ?? this.capacity) * size;
    const buffer = new ArrayBuffer(this.buffer.byteLength - totalSize);
    const tmp = new Uint8Array(buffer);
    tmp.set(new Uint8Array(this.buffer, 0, offset));
    tmp.set(new Uint8Array(this.buffer, offset + totalSize));
    this.buffer = buffer;

    // Nudge all remaining components back (maps maintain set order)
    let after = false;
    for (const [c, s] of this.map) {
      if (after) {
        Object.entries(s).forEach(([k, v]) => {
          const { byteLength, byteOffset } = v;
          const Ctr = v.constructor as TypedArrayConstructor;
          s[k] = new Ctr(buffer, byteOffset - totalSize, byteLength);
        });
      }
      if (!after && c === component) after = true;
    }

    return true;
  }

  replace(source: ArrayBuffer): DynamicBuffer {
    if (source.byteLength !== this.buffer.byteLength) {
      throw new Error("setBuffer: byteLength mismatch!");
    }
    const view = new Uint8Array(source);
    const target = new Uint8Array(this.buffer);
    target.set(view);
    return this;
  }
}
