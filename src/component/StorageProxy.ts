import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { Partition, PartitionedBuffer } from "@phughesmcr/partitionedbuffer";
import { hasOwnProperty } from "../utils.ts";

export type StorageProxySpec<T> = {
  changed: BooleanArray;
  storage: Partition<T>;
};

export class StorageProxy<T> {
  /** The component's changed entity set */
  #changed: Bitfield;

  /** The current entity ID the proxy is pointed at */
  #cursor: Entity = 0 as Entity;

  /** The component's raw storage */
  #storage: SchemaStorage<T>;

  constructor(spec: StorageProxySpec<T>) {
    const { changed, storage } = spec;
    this.#changed = changed;
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
        set(value: number | bigint) {
          const storage = this.#storage.storage[key as keyof T];
          if (storage[this.#cursor] !== value) {
            storage[this.#cursor] = value;
            this.#changed.toggle(this.#cursor, true);
          }
        },
        enumerable: true,
        configurable: false,
      });
    }
  }
}
