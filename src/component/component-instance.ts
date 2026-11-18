import { ComponentDataError, ComponentOwnershipError } from "@/errors.ts";
import type { ComponentInstanceSpec } from "@/types/component.ts";
import type {
  ComponentData,
  ComponentPartitions,
  ComponentStorage,
  ComponentValue,
  SchemaOrNull,
  StorageProxyWithProperties,
} from "@/types/partitions.ts";
import { asSlotIndex, type Entity, entityIndex, type SlotIndex } from "@/entity/entity.ts";
import { hasOwnProperty } from "@/utils.ts";
import type { Component } from "./component.ts";

/** A ComponentInstance is the world-local representation of a component */
export class ComponentInstance<
  TValue extends SchemaOrNull,
  TStorage extends SchemaOrNull = TValue,
> {
  /** The ComponentInstance's id */
  readonly id: number;

  /** Direct ownership check for hot paths */
  readonly #has: (entity: Entity) => boolean;

  /** Ownership-guarded changed marker for hot paths */
  readonly #markChanged: (entity: Entity) => boolean;

  /** Revision provider */
  readonly #getRevision: () => number;

  /** Raw cell decoder for `field.*` columns, or `undefined` when every column is numeric */
  readonly #decode: ((key: string, raw: unknown) => unknown) | undefined;

  /** The ComponentInstance's proxy */
  readonly proxy: TStorage extends null ? null : StorageProxyWithProperties<TValue>;

  /** The ComponentInstance's storage */
  readonly storage: TStorage extends null ? null : ComponentStorage<TStorage>;

  /**
   * Raw columns for direct storage access, or `null` for tag components. Numeric and bool / enum / entity fields are
   * typed arrays holding raw values (0 / 1, label index, packed handle or -1); string / object fields are JS arrays.
   *
   * Direct access is an unguarded escape hatch: writes are not ownership-checked or change-tracked, and writes to
   * non-owner slots are never reported by `getChanged`. For components with `maxEntities`, a non-owner write may
   * temporarily occupy one of the capped dense rows; those rows are reclaimed (and their data discarded) the next
   * time an add needs them, so stray writes can never block an owner from being added.
   */
  get partitions(): ComponentPartitions<TStorage> {
    return (this.storage?.partitions ?? null) as ComponentPartitions<TStorage>;
  }

  /** The ComponentInstance's prototype */
  readonly type: Component<TValue, TStorage>;

  /**
   * Create a new ComponentInstance
   * @param spec The ComponentInstance's specification
   * @throws {TypeError} If the spec is invalid
   */
  constructor(spec: ComponentInstanceSpec<TValue, TStorage>) {
    const { has, id, markChanged, proxy, storage, type, getRevision, decode } = spec;
    this.id = id;
    this.#has = has;
    this.#markChanged = markChanged;
    this.#getRevision = getRevision ?? (() => 0);
    this.#decode = decode;
    this.proxy = proxy as TStorage extends null ? null : StorageProxyWithProperties<TValue>;
    this.storage = storage as TStorage extends null ? null : ComponentStorage<TStorage>;
    this.type = type;
    Object.freeze(this);
  }

  /** The ComponentInstance's name */
  get name(): string {
    return this.type.name;
  }

  /**
   * Monotonic token that increases when this component's membership or stored
   * values change.
   */
  get revision(): number {
    return this.#getRevision();
  }

  /** Check whether an entity owns this component instance. */
  has(entity: Entity): boolean {
    return this.#has(entity);
  }

  /** Mark an owning data component entity as changed. */
  markChanged(entity: Entity): boolean {
    return this.#markChanged(entity);
  }

  /**
   * Read a property for a packed entity handle (validates ownership via {@link has}). Field columns decode: bools to
   * `boolean`, enums to their label, entity refs to the handle or `null` once stale. The untyped `string` key overload
   * is typed `number`; cast its result for `field.*` columns.
   */
  get<K extends keyof ComponentData<TValue> & string>(entity: Entity, key: K): ComponentData<TValue>[K];
  /** Read a property by untyped key; cast the result for `field.*` columns. */
  get(entity: Entity, key: string): number;
  get(entity: Entity, key: string): unknown {
    const partitions = this.storage?.partitions as Record<string, unknown> | undefined;
    if (partitions === undefined) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    if (!this.has(entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${this.name}.`);
    }
    return this.getAt(entityIndex(entity), key);
  }

  /** Write a property for a packed entity handle, validating it like the proxy does. */
  set<K extends keyof ComponentValue<TValue> & string>(entity: Entity, key: K, value: ComponentValue<TValue>[K]): void;
  /** Write a property by untyped key; the value is validated at runtime. */
  set(entity: Entity, key: string, value: unknown): void;
  set(entity: Entity, key: string, value: unknown): void {
    if (this.proxy === null) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    if (!hasOwnProperty(this.storage!.partitions, key)) {
      throw new ComponentDataError(`Component ${this.name} does not define data field "${key}".`);
    }
    this.proxy.entity = entity;
    (this.proxy as Record<string, unknown>)[key] = value;
  }

  /** Read a property by raw slot with no generation or membership check. Field columns decode like {@link get}. */
  getAt<K extends keyof ComponentData<TValue> & string>(slot: SlotIndex, key: K): ComponentData<TValue>[K];
  /** Read a property by raw slot and untyped key; cast the result for `field.*` columns. */
  getAt(slot: SlotIndex, key: string): number;
  getAt(slot: SlotIndex, key: string): unknown {
    const partitions = this.storage?.partitions as Record<string, ArrayLike<unknown>> | undefined;
    if (partitions === undefined) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    if (!hasOwnProperty(partitions, key)) {
      throw new ComponentDataError(`Component ${this.name} does not define data field "${key}".`);
    }
    const raw = partitions[key]![slot];
    const decode = this.#decode;
    return decode === undefined ? raw : decode(key, raw);
  }

  /** Write a property by raw slot with no generation or membership check. Values are validated like {@link set}. */
  setAt<K extends keyof ComponentValue<TValue> & string>(
    slot: SlotIndex,
    key: K,
    value: ComponentValue<TValue>[K],
  ): void;
  /** Write a property by raw slot and untyped key; the value is validated at runtime. */
  setAt(slot: SlotIndex, key: string, value: unknown): void;
  setAt(slot: SlotIndex, key: string, value: unknown): void {
    if (this.proxy === null) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    if (!hasOwnProperty(this.storage!.partitions, key)) {
      throw new ComponentDataError(`Component ${this.name} does not define data field "${key}".`);
    }
    this.proxy.slot = asSlotIndex(slot);
    (this.proxy as Record<string, unknown>)[key] = value;
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "ComponentInstance";
  }
}
