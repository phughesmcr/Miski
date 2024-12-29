import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { Partition } from "@phughesmcr/partitionedbuffer";
import type { Entity, SchemaStorage } from "../types.ts";
import { hasOwnProperty } from "../utils.ts";

export type StorageProxySpec<T> = {
  changed: BooleanArray;
  storage: Partition<T>;
};

export class StorageProxy<T> {
  /** The current entity ID the proxy is pointed at */
  #cursor: Entity = 0 as Entity;

  /** The component's raw storage */
  #storage: SchemaStorage<T>;

  constructor(spec: StorageProxySpec<T>) {
    const { changed, storage } = spec;
    this.#storage = storage;

    // Create a getter and setter for each storage property
    for (const key in storage.storage) {
      if (!hasOwnProperty(storage, key)) {
        continue;
      }
      Object.defineProperty(this, key, {
        get() {
          return this.#storage.storage[key as keyof T][this.#cursor];
        },
        set(value: number) {
          const storage = this.#storage.storage[key as keyof T];
          if (storage[this.#cursor] !== value) {
            storage[this.#cursor] = value;
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
