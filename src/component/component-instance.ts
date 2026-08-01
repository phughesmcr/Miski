import type { ComponentInstanceSpec } from "@/types/component.ts";
import type {
  ComponentPartitions,
  PartitionStorage,
  SchemaOrNull,
  StorageProxyWithProperties,
  TypedArray,
} from "@/types/partitions.ts";
import { asSlotIndex, type Entity, entityIndex, type SlotIndex } from "@/entity/entity.ts";
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

  /** The ComponentInstance's proxy */
  readonly proxy: TStorage extends null ? null : StorageProxyWithProperties<TValue>;

  /** The ComponentInstance's storage */
  readonly storage: TStorage extends null ? null : PartitionStorage<TStorage>;

  /** Typed-array partitions for direct storage access, or `null` for tag components */
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
    const { has, id, markChanged, proxy, storage, type, getRevision } = spec;
    this.id = id;
    this.#has = has;
    this.#markChanged = markChanged;
    this.#getRevision = getRevision ?? (() => 0);
    this.proxy = proxy as TStorage extends null ? null : StorageProxyWithProperties<TValue>;
    this.storage = storage as TStorage extends null ? null : PartitionStorage<TStorage>;
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

  /** Read a property for a packed entity handle (validates ownership via {@link has}). */
  get(entity: Entity, key: string): number {
    const partitions = this.storage?.partitions as Record<string, TypedArray> | undefined;
    if (partitions === undefined) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    return partitions[key]![entityIndex(entity)]!;
  }

  /** Write a property for a packed entity handle. */
  set(entity: Entity, key: string, value: number): void {
    if (this.proxy === null) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    this.proxy.entity = entity;
    (this.proxy as Record<string, number>)[key] = value;
  }

  /** Read a property by raw slot with no generation or membership check. */
  getAt(slot: SlotIndex, key: string): number {
    const partitions = this.storage?.partitions as Record<string, TypedArray> | undefined;
    if (partitions === undefined) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    return partitions[key]![slot]!;
  }

  /** Write a property by raw slot with no generation or membership check. */
  setAt(slot: SlotIndex, key: string, value: number): void {
    if (this.proxy === null) {
      throw new TypeError(`Component ${this.name} has no data storage.`);
    }
    this.proxy.slot = asSlotIndex(slot);
    (this.proxy as Record<string, number>)[key] = value;
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "ComponentInstance";
  }
}
