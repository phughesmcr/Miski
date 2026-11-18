import { ComponentOwnershipError, EntityNotFoundError, formatEntityOutOfRange } from "@/errors.ts";
import { asSlotIndex, type Entity, entityIndex, packEntity, type SlotIndex } from "@/entity/entity.ts";
import type { SchemaOrNull, StorageProxySpec, TypedArray } from "@/types/partitions.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";
import {
  decodeFieldValue,
  encodeFieldValue,
  type FieldCodec,
  type SideField,
  validateSideValue,
} from "./field-codec.ts";

/** A reusable slot cursor over component storage. Entity targets additionally validate ownership. */
export class StorageProxy<T extends SchemaOrNull> {
  #entity: Entity | undefined;
  #slot: SlotIndex = 0 as SlotIndex;
  #capacity: number;
  #has: (entity: Entity) => boolean;
  #packSlot: (slot: number) => Entity;

  /** Create a proxy with reusable canonicalization buffers for every numeric column. */
  constructor(
    spec: StorageProxySpec<T> & {
      componentName?: string;
      coercionScratch: Record<string, TypedArray>;
      /** Codecs for bool / enum / entity columns, keyed by field name. */
      codecs?: Readonly<Record<string, FieldCodec>>;
      /** Descriptors for string / object columns, keyed by field name. */
      sideFields?: Readonly<Record<string, SideField>>;
      /** Canonical entity liveness check for entity fields. */
      isEntityActive?: (entity: Entity) => boolean;
    },
  ) {
    const { capacity, markChanged, storage, coercionScratch } = spec;
    const componentName = spec.componentName ?? "component";
    const isEntityActive = spec.isEntityActive ?? (() => true);
    this.#capacity = capacity;
    this.#has = spec.has;
    this.#packSlot = spec.packSlot ?? ((slot) => packEntity(slot, 0));
    if (storage === null) return;
    const partitions = storage.partitions as unknown as Record<string, TypedArray | unknown[]>;
    const markSlotChanged = (slot: number): void => markChanged(slot as SlotIndex);
    for (const key of Object.keys(partitions)) {
      const codec = spec.codecs?.[key];
      const side = spec.sideFields?.[key];
      if (codec !== undefined) {
        this.#defineCodecProperty(key, partitions[key] as TypedArray, codec, {
          componentName,
          isEntityActive,
          markChanged: markSlotChanged,
        });
        continue;
      }
      if (side !== undefined) {
        this.#defineSideProperty(key, partitions[key] as unknown[], side, componentName, markSlotChanged);
        continue;
      }
      const store = partitions[key] as TypedArray;
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

  /** Define a decoding / encoding accessor for a bool, enum or entity column. */
  #defineCodecProperty(
    key: string,
    store: TypedArray,
    codec: FieldCodec,
    context: {
      componentName: string;
      isEntityActive: (entity: Entity) => boolean;
      markChanged: (slot: number) => void;
    },
  ): void {
    const { componentName, isEntityActive, markChanged } = context;
    Object.defineProperty(this, key, {
      get: () => {
        this.#validateTarget();
        return decodeFieldValue(codec, store[this.#slot]!, isEntityActive);
      },
      set: (value: unknown) => {
        this.#validateTarget();
        const raw = encodeFieldValue(codec, componentName, key, value, isEntityActive);
        if (store[this.#slot] !== raw) {
          store[this.#slot] = raw;
          markChanged(this.#slot);
        }
      },
      enumerable: true,
      configurable: false,
    });
  }

  /** Define a validating accessor for a string or object column. */
  #defineSideProperty(
    key: string,
    store: unknown[],
    side: SideField,
    componentName: string,
    markChanged: (slot: number) => void,
  ): void {
    Object.defineProperty(this, key, {
      get: () => {
        this.#validateTarget();
        return store[this.#slot];
      },
      set: (value: unknown) => {
        this.#validateTarget();
        validateSideValue(side, componentName, key, value);
        if (!Object.is(store[this.#slot], value)) {
          store[this.#slot] = value;
          markChanged(this.#slot);
        }
      },
      enumerable: true,
      configurable: false,
    });
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
