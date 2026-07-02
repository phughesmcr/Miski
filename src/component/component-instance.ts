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
  Schema,
  SchemaOrNull,
  StorageProxyWithProperties,
} from "@/types/partitions.ts";
import type { Component } from "./component.ts";

/** A ComponentInstance is the world-local representation of a component */
export class ComponentInstance<T extends SchemaOrNull> {
  /** The ComponentInstance's id */
  readonly id: number;

  /** The ComponentInstance's proxy */
  readonly proxy: T extends Schema<T> ? StorageProxyWithProperties<T> : null;

  /** The ComponentInstance's storage */
  readonly storage: T extends Schema<T> ? PartitionStorage<T> : null;

  /** Typed-array partitions for direct storage access, or `null` for tag components */
  get partitions(): ComponentPartitions<T> {
    return (this.storage?.partitions ?? null) as ComponentPartitions<T>;
  }

  /** The ComponentInstance's prototype */
  readonly type: Component<T>;

  /**
   * Create a new ComponentInstance
   * @param spec The ComponentInstance's specification
   * @throws {TypeError} If the spec is invalid
   */
  constructor(spec: ComponentInstanceSpec<T>) {
    const { id, proxy, storage, type } = spec;
    this.id = id;
    this.proxy = proxy as T extends Schema<T> ? StorageProxyWithProperties<T> : null;
    this.storage = storage as T extends Schema<T> ? PartitionStorage<T> : null;
    this.type = type;
    Object.freeze(this);
  }

  /** The ComponentInstance's name */
  get name(): string {
    return this.type.name;
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "ComponentInstance";
  }
}
