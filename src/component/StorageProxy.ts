/**
 * @module      StorageProxy
 * @description A StorageProxy is a wrapper around a component's storage for shorter access paths and change detection
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Entity, SchemaStorage, StorageProxySpec } from "../types.ts";
import { hasOwnProperty } from "../utils.ts";

/** A StorageProxy is a wrapper around a component's storage */
export class StorageProxy<T> {
  /** The current entity ID the proxy is pointed at */
  #cursor: Entity = 0 as Entity;

  /** The component's raw storage */
  readonly storage: SchemaStorage<T>;

  /**
   * Create a new StorageProxy
   * @param spec - The specification for the StorageProxy
   */
  constructor(spec: StorageProxySpec<T>) {
    const { changed, storage } = spec;
    this.storage = storage;

    // Create a getter and setter for each storage property
    for (const key in storage.partitions) {
      if (hasOwnProperty(storage, key) === false) {
        continue;
      }
      Object.defineProperty(this, key, {
        get() {
          return this.storage.partitions[key as keyof T][this.#cursor];
        },
        set(value: number) {
          const store = this.storage.partitions[key as keyof T];
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
    this.#cursor = value;
  }
}
