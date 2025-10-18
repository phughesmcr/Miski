/**
 * @module      StorageProxy
 * @description A StorageProxy is a wrapper around a component's storage for shorter access paths and change detection
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { EntityNotFoundError } from "../errors.ts";
import type { Entity, SchemaOrNull, StorageProxySpec, TypedArray } from "../types.ts";
import { hasOwnProperty } from "../utils.ts";

/** A StorageProxy is a wrapper around a component's storage */
export class StorageProxy<T extends SchemaOrNull<T>> {
  /** The current entity ID the proxy is pointed at */
  #entity: Entity = 0 as Entity;

  /** The capacity of the StorageProxy */
  #capacity: number;

  /**
   * Create a new StorageProxy
   * @param spec - The specification for the StorageProxy
   */
  constructor(spec: StorageProxySpec<T>) {
    const { capacity, changed, storage } = spec;

    this.#capacity = capacity;

    // Create a getter and setter for each storage property
    for (const key in storage?.partitions) {
      if (!hasOwnProperty(storage?.partitions, key)) continue;
      Object.defineProperty(this, key, {
        get: () => storage?.partitions[key as keyof T][this.#entity],
        set: (value: number) => {
          const store = storage.partitions[key as keyof T] as TypedArray;
          if (store[this.#entity] !== value) {
            store[this.#entity] = value;
            changed.set(this.#entity, true);
          }
        },
        enumerable: true,
        configurable: false,
      });
    }
  }

  /** The current entity ID the proxy is pointed at */
  get entity(): Entity {
    return this.#entity;
  }

  /** Set the current entity ID the proxy is pointed at */
  set entity(value: Entity) {
    if (value < 0 || value >= this.#capacity) {
      throw new EntityNotFoundError(`Entity ${value} not found`);
    }
    this.#entity = value;
  }
}
