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

/** Validate, encode and write one value into one column slot, marking the slot changed when the cell changes. */
export type ColumnWriter = (slot: number, value: unknown) => void;

/** Inputs for {@link createColumnWriters}. */
export type ColumnWritersSpec = {
  /** Component storage whose `partitions` hold every typed and side column. */
  storage: { readonly partitions: unknown };
  /** Component name used in validation errors. */
  componentName: string;
  /** Reusable one-element canonicalization buffers for numeric columns, keyed by field name. */
  coercionScratch: Record<string, TypedArray>;
  /** Codecs for bool / enum / entity columns, keyed by field name. */
  codecs?: Readonly<Record<string, FieldCodec>>;
  /** Descriptors for string / object columns, keyed by field name. */
  sideFields?: Readonly<Record<string, SideField>>;
  /** Canonical entity liveness check for entity fields. */
  isEntityActive: (entity: Entity) => boolean;
  /** Called with the slot after a write changes a cell. */
  markChanged: (slot: number) => void;
};

/**
 * Build one allocation-free writer per column. The proxy setters and `ComponentInstance.set` share these,
 * so every single-field write applies the same validation, encoding and change tracking.
 * @returns a null-prototype map from field name to writer
 */
export function createColumnWriters(spec: ColumnWritersSpec): Readonly<Record<string, ColumnWriter>> {
  const { componentName, coercionScratch, codecs, sideFields, isEntityActive, markChanged } = spec;
  const partitions = spec.storage.partitions as Record<string, TypedArray | unknown[]>;
  const writers: Record<string, ColumnWriter> = Object.create(null);
  for (const key of Object.keys(partitions)) {
    const codec = codecs?.[key];
    const side = sideFields?.[key];
    if (codec !== undefined) {
      const store = partitions[key] as TypedArray;
      writers[key] = (slot, value) => {
        const raw = encodeFieldValue(codec, componentName, key, value, isEntityActive);
        if (store[slot] !== raw) {
          store[slot] = raw;
          markChanged(slot);
        }
      };
    } else if (side !== undefined) {
      const store = partitions[key] as unknown[];
      writers[key] = (slot, value) => {
        validateSideValue(side, componentName, key, value);
        if (!Object.is(store[slot], value)) {
          store[slot] = value;
          markChanged(slot);
        }
      };
    } else {
      const store = partitions[key] as TypedArray;
      const scratch = coercionScratch[key]!;
      writers[key] = (slot, value) => {
        const canonical = canonicalizeStoredValue(componentName, key, value as number, scratch);
        if (!Object.is(store[slot], canonical)) {
          store[slot] = canonical;
          markChanged(slot);
        }
      };
    }
  }
  return Object.freeze(writers);
}

/** A reusable slot cursor over component storage. Entity targets additionally validate ownership. */
export class StorageProxy<T extends SchemaOrNull> {
  #entity: Entity | undefined;
  #slot: SlotIndex = 0 as SlotIndex;
  #capacity: number;
  #has: (entity: Entity) => boolean;
  #packSlot: (slot: number) => Entity;

  /** Create a proxy whose field accessors read columns directly and write through the shared column writers. */
  constructor(
    spec: StorageProxySpec<T> & {
      /** Shared per-column writers from {@link createColumnWriters}. */
      writers: Readonly<Record<string, ColumnWriter>>;
      /** Codecs for bool / enum / entity columns, keyed by field name. */
      codecs?: Readonly<Record<string, FieldCodec>>;
      /** Canonical entity liveness check for entity fields. */
      isEntityActive?: (entity: Entity) => boolean;
    },
  ) {
    const { capacity, storage, writers } = spec;
    const isEntityActive = spec.isEntityActive ?? (() => true);
    this.#capacity = capacity;
    this.#has = spec.has;
    this.#packSlot = spec.packSlot ?? ((slot) => packEntity(slot, 0));
    if (storage === null) return;
    const partitions = storage.partitions as unknown as Record<string, ArrayLike<unknown>>;
    for (const key of Object.keys(partitions)) {
      const store = partitions[key]!;
      const codec = spec.codecs?.[key];
      const write = writers[key]!;
      Object.defineProperty(this, key, {
        get: codec === undefined ?
          () => {
            this.#validateTarget();
            return store[this.#slot];
          } :
          () => {
            this.#validateTarget();
            return decodeFieldValue(codec, store[this.#slot] as number, isEntityActive);
          },
        set: (value: unknown) => {
          this.#validateTarget();
          write(this.#slot, value);
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
