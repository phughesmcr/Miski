/**
 * @module      ComponentInstance
 * @description A component instance is the world-local representation of a component.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { ComponentInstanceSpec } from "@/types/component.ts";
import type {
  ComponentPartitions,
  PartitionStorage,
  SchemaOrNull,
  StorageProxyWithProperties,
} from "@/types/partitions.ts";
import type { Entity } from "@/entity/entity-id.ts";
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
    const { has, id, markChanged, proxy, storage, type } = spec;
    this.id = id;
    this.#has = has;
    this.#markChanged = markChanged;
    this.proxy = proxy as TStorage extends null ? null : StorageProxyWithProperties<TValue>;
    this.storage = storage as TStorage extends null ? null : PartitionStorage<TStorage>;
    this.type = type;
    Object.freeze(this);
  }

  /** The ComponentInstance's name */
  get name(): string {
    return this.type.name;
  }

  /** Check whether an entity owns this component instance. */
  has(entity: Entity): boolean {
    return this.#has(entity);
  }

  /** Mark an owning data component entity as changed. */
  markChanged(entity: Entity): boolean {
    return this.#markChanged(entity);
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "ComponentInstance";
  }
}
