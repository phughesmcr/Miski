import { ComponentOwnershipError, EntityNotFoundError, formatEntityOutOfRange } from "@/errors.ts";
import { asSlotIndex, type Entity, entityIndex, packEntity, type SlotIndex } from "@/entity/entity.ts";
import type { SchemaOrNull, StorageProxySpec, TypedArray } from "@/types/partitions.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";

/** A reusable slot cursor over component storage. Entity targets additionally validate ownership. */
export class StorageProxy<T extends SchemaOrNull> {
  #entity: Entity | undefined;
  #slot: SlotIndex = 0 as SlotIndex;
  #capacity: number;
  #has: (entity: Entity) => boolean;
  #packSlot: (slot: number) => Entity;

  /** Create a proxy with reusable canonicalization buffers for every column. */
  constructor(
    spec: StorageProxySpec<T> & {
      componentName?: string;
      coercionScratch: Record<string, TypedArray>;
    },
  ) {
    const { capacity, markChanged, storage, coercionScratch } = spec;
    const componentName = spec.componentName ?? "component";
    this.#capacity = capacity;
    this.#has = spec.has;
    this.#packSlot = spec.packSlot ?? ((slot) => packEntity(slot, 0));
    if (storage === null) return;
    for (const key of Object.keys(storage.partitions)) {
      const store = storage.partitions[key as keyof T] as TypedArray;
      const scratch = coercionScratch[key]!;
      Object.defineProperty(this, key, {
        get: () => {
          this.#validateTarget();
          return store[this.#slot];
        },
        set: (value: number) => {
          this.#validateTarget();
          const canonical = canonicalizeStoredValue(componentName, key, value, scratch);
          if (!Object.is(store[this.#slot], canonical)) {
            store[this.#slot] = canonical;
            markChanged(this.#slot);
          }
        },
        enumerable: true,
        configurable: false,
      });
    }
    Object.preventExtensions(this);
  }

  #validateTarget(): void {
    if (this.#entity !== undefined && !this.#has(this.#entity)) {
      throw new ComponentOwnershipError(`Entity ${this.#entity} does not own this component.`);
    }
  }

  /** The current packed entity target, or the live handle for a raw slot target. */
  get entity(): Entity {
    return this.#entity ?? this.#packSlot(this.#slot);
  }

  /** Point at a packed entity, validating both liveness and component ownership. */
  set entity(value: Entity) {
    const slot = entityIndex(value);
    if (slot >= this.#capacity) {
      throw new EntityNotFoundError(formatEntityOutOfRange(value));
    }
    if (!this.#has(value)) {
      throw new ComponentOwnershipError(`Entity ${value} does not own this component.`);
    }
    this.#entity = value;
    this.#slot = asSlotIndex(slot);
  }

  /** The current raw storage slot. */
  get slot(): SlotIndex {
    return this.#slot;
  }

  /** Point at a raw storage slot without generation or membership checks. */
  set slot(value: SlotIndex) {
    if (!Number.isInteger(value) || value < 0 || value >= this.#capacity) {
      throw new EntityNotFoundError(formatEntityOutOfRange(value as unknown as Entity));
    }
    this.#entity = undefined;
    this.#slot = value;
  }
}
