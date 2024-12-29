import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { Partition } from "@phughesmcr/partitionedbuffer";
import { hasOwnProperty } from "../utils.ts";
import type { BigTypedArray, Entity } from "../types.ts";

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
        set(value: T[keyof T] extends BigTypedArray ? bigint : number) {
          const storage = this.#storage.storage[key as keyof T];
          if (storage[this.#cursor] !== value) {
            if (typeof storage[this.#cursor] !== typeof value) {
              throw new TypeError(
                `Cannot set ${key} to ${typeof value} (${value}). Expected ${typeof storage[this.#cursor]}.`,
              );
            }
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
