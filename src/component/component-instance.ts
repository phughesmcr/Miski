import { ComponentDataError, ComponentOwnershipError, EntityNotFoundError, formatEntityOutOfRange } from "@/errors.ts";
import type { ComponentInstanceSpec } from "@/types/component.ts";
import type {
  ComponentData,
  ComponentStorage,
  ComponentValue,
  SchemaOrNull,
  StorageProxyWithProperties,
} from "@/types/partitions.ts";
import { type Entity, entityIndex } from "@/entity/entity.ts";
import { hasOwnProperty } from "@/utils.ts";
import type { ColumnWriter } from "./storage-proxy.ts";
import type { Component } from "./component.ts";

/**
 * A ComponentInstance is the world-local representation of a component.
 *
 * Values are read and written at one of three tiers:
 * - (a) hot path: `instance.storage.partitions[key][slot]`, raw and unguarded;
 * - (b) guarded cursor: `instance.proxy`, or `instance.get` / `instance.set` for one field by entity handle;
 * - (c) world-level guarded calls: `world.components.getEntityData`, `getEntityDataOrThrow`, `readEntityDataInto` and
 *   `setEntityData`.
 */
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

  /** Shared per-column writers (null-prototype), or `null` for tag components */
  readonly #writers: Readonly<Record<string, ColumnWriter>> | null;

  /** The world's entity capacity (exclusive upper bound for slots) */
  readonly #capacity: number;

  /** Raw cell decoder for `field.*` columns, or `undefined` when every column is numeric */
  readonly #decode: ((key: string, raw: unknown) => unknown) | undefined;

  /**
   * Tier (b), the guarded cursor: point `proxy.entity` at an owner, then read and write its fields as properties.
   * Writes validate, encode and mark the entity changed. `null` for tag components.
   */
  readonly proxy: TStorage extends null ? null : StorageProxyWithProperties<TValue>;

  /**
   * Tier (a), the hot path: `storage.partitions[key][slot]` holds raw columns indexed by storage slot
   * (`entityIndex(entity)` or a query's `slots`), or `storage` is `null` for tag components. Numeric and bool / enum /
   * entity fields are typed arrays holding raw values (0 / 1, label index, packed handle or -1); string / object fields
   * are JS arrays.
   *
   * Direct access is an unguarded escape hatch: writes are not validated, ownership-checked or change-tracked, and
   * writes to non-owner slots are never reported by `getChanged`. For components with `maxOwners`, a non-owner write
   * may temporarily occupy one of the capped dense rows; those rows are reclaimed (and their data discarded) the next
   * time an add needs them, so stray writes can never block an owner from being added.
   */
  readonly storage: TStorage extends null ? null : ComponentStorage<TStorage>;

  /** The ComponentInstance's prototype */
  readonly type: Component<TValue, TStorage>;

  /**
   * Create a new ComponentInstance
   * @param spec The ComponentInstance's specification
   */
  constructor(spec: ComponentInstanceSpec<TValue, TStorage>) {
    const { has, id, markChanged, proxy, storage, type, getRevision, decode, writers, capacity } = spec;
    this.id = id;
    this.#has = has;
    this.#markChanged = markChanged;
    this.#getRevision = getRevision ?? (() => 0);
    this.#decode = decode;
    this.#writers = writers ?? null;
    this.#capacity = capacity;
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
   * Read one field of an owning entity. Field columns decode: bools to `boolean`, enums to their label, entity refs to
   * the handle or `null` once stale. The untyped `string` key overload is typed `number`; cast its result for
   * `field.*` columns.
   * @throws {ComponentOwnershipError} If the entity is inactive or does not own this component
   * @throws {ComponentDataError} If the component does not define `key`
   * @throws {ComponentDataError} If this is a tag component
   */
  get<K extends keyof ComponentData<TValue> & string>(entity: Entity, key: K): ComponentData<TValue>[K];
  /** Read a property by untyped key; cast the result for `field.*` columns. */
  get(entity: Entity, key: string): number;
  get(entity: Entity, key: string): unknown {
    const partitions = this.storage?.partitions as Record<string, ArrayLike<unknown>> | undefined;
    if (partitions === undefined) {
      throw new ComponentDataError(`Component ${this.name} has no data storage.`);
    }
    if (!this.#has(entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${this.name}.`);
    }
    if (!hasOwnProperty(partitions, key)) {
      throw new ComponentDataError(`Component ${this.name} does not define data field "${key}".`);
    }
    const raw = partitions[key]![entityIndex(entity)];
    const decode = this.#decode;
    return decode === undefined ? raw : decode(key, raw);
  }

  /**
   * Write one field of an owning entity, validating, encoding and marking it changed like the proxy does. Does not
   * move {@link proxy}.
   * @throws {EntityNotFoundError} If the entity is outside world capacity
   * @throws {ComponentOwnershipError} If the entity is inactive or does not own this component
   * @throws {ComponentDataError} If the component does not define `key`, or `value` is invalid for the field
   * @throws {ComponentDataError} If this is a tag component
   */
  set<K extends keyof ComponentValue<TValue> & string>(entity: Entity, key: K, value: ComponentValue<TValue>[K]): void;
  /** Write a property by untyped key; the value is validated at runtime. */
  set(entity: Entity, key: string, value: unknown): void;
  set(entity: Entity, key: string, value: unknown): void {
    const write = this.#writer(key);
    const slot = entityIndex(entity);
    if (slot >= this.#capacity) throw new EntityNotFoundError(formatEntityOutOfRange(entity));
    if (!this.#has(entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${this.name}.`);
    }
    write(slot, value);
  }

  /** Resolve the shared writer for `key`, throwing for tag components and undeclared fields. */
  #writer(key: string): ColumnWriter {
    const writers = this.#writers;
    if (writers === null) {
      throw new ComponentDataError(`Component ${this.name} has no data storage.`);
    }
    const write = writers[key];
    if (write === undefined) {
      throw new ComponentDataError(`Component ${this.name} does not define data field "${key}".`);
    }
    return write;
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "ComponentInstance";
  }
}
