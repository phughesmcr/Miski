/**
 * @module      StorageProxy
 * @description A StorageProxy is a wrapper around a component's storage for shorter access paths and change detection
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { EntityNotFoundError } from "../errors.ts";
import type { Entity, SchemaOrNull, StorageProxySpec } from "../types.ts";
import { hasOwnProperty } from "../utils.ts";

/** A StorageProxy is a wrapper around a component's storage */
export class StorageProxy<T extends SchemaOrNull<T>> {
  /** The current entity ID the proxy is pointed at */
  #cursor: Entity = 0 as Entity;

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
    for (const key in storage.partitions) {
      if (!hasOwnProperty(storage, key)) continue;
      Object.defineProperty(this, key, {
        get: () => storage.partitions[key as keyof T][this.#cursor],
        set: (value: number) => {
          const store = storage.partitions[key as keyof T];
          if (store[this.#cursor] !== value) {
            store[this.#cursor] = value;
            changed.setBool(this.#cursor, true);
          }
        },
        enumerable: true,
        configurable: false,
      });
    }
  }

  /** The current entity ID the proxy is pointed at */
  get cursor(): Entity {
    return this.#cursor;
  }

  /** Set the current entity ID the proxy is pointed at */
  set cursor(value: Entity) {
    if (value < 0 || value >= this.#capacity) {
      throw new EntityNotFoundError(value);
    }
    this.#cursor = value;
  }
}
