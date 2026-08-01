import { EntityNotFoundError, formatEntityOutOfRange } from "@/errors.ts";
import { asSlotIndex, type Entity, entityIndex, type SlotIndex } from "@/entity/entity.ts";
import type { SchemaOrNull, StorageProxySpec, TypedArray } from "@/types/partitions.ts";
import { hasOwnProperty } from "@/utils.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";

/** A StorageProxy is a wrapper around a component's storage */
export class StorageProxy<T extends SchemaOrNull> {
  /** The current packed entity handle the proxy is pointed at */
  #entity: Entity = 0 as Entity;

  /** The current storage slot derived from {@link #entity} */
  #slot: SlotIndex = 0 as SlotIndex;

  /** The capacity of the StorageProxy */
  #capacity: number;

  /** Component name used in coercion errors */
  #componentName: string;

  /** One-element scratch buffers keyed by property for value canonicalization */
  #coercionScratch: Record<string, TypedArray>;

  /** Optional hook invoked before a column write (rollback capture). */
  #beforeWrite?: (slot: SlotIndex, key: string) => void;

  /**
   * Create a new StorageProxy
   * @param spec - The specification for the StorageProxy
   */
  constructor(
    spec: StorageProxySpec<T> & {
      componentName?: string;
      coercionScratch?: Record<string, TypedArray>;
      beforeWrite?: (slot: SlotIndex, key: string) => void;
    },
  ) {
    const { capacity, markChanged, storage } = spec;

    this.#capacity = capacity;
    this.#componentName = spec.componentName ?? "component";
    this.#coercionScratch = spec.coercionScratch ?? {};
    this.#beforeWrite = spec.beforeWrite;

    // Create a getter and setter for each storage property
    for (const key in storage?.partitions) {
      if (!hasOwnProperty(storage?.partitions, key)) continue;
      Object.defineProperty(this, key, {
        get: () => storage?.partitions[key as keyof T][this.#slot],
        set: (value: number) => {
          const store = storage.partitions[key as keyof T] as TypedArray;
          const scratch = this.#coercionScratch[key as string];
          const canonical = scratch === undefined ?
            value :
            canonicalizeStoredValue(this.#componentName, key as string, value, scratch);
          if (!Object.is(store[this.#slot], canonical)) {
            this.#beforeWrite?.(this.#slot, key as string);
            store[this.#slot] = canonical;
            markChanged(this.#entity);
          }
        },
        enumerable: true,
        configurable: false,
      });
    }
  }

  /** The current packed entity handle the proxy is pointed at */
  get entity(): Entity {
    return this.#entity;
  }

  /** Set the current packed entity handle the proxy is pointed at */
  set entity(value: Entity) {
    const slot = entityIndex(value);
    if (slot < 0 || slot >= this.#capacity) {
      throw new EntityNotFoundError(formatEntityOutOfRange(value));
    }
    this.#entity = value;
    this.#slot = asSlotIndex(slot);
  }

  /** The current storage slot the proxy is pointed at */
  get slot(): SlotIndex {
    return this.#slot;
  }

  /** Point the proxy at a raw storage slot without generation checks. */
  set slot(value: SlotIndex) {
    if (value < 0 || value >= this.#capacity) {
      throw new EntityNotFoundError(formatEntityOutOfRange(value as unknown as Entity));
    }
    this.#slot = value;
  }
}
