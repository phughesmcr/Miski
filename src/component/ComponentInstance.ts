/**
 * @module      ComponentInstance
 * @description A component instance is the world-local representation of a component.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type {
  ComponentInstanceSpec,
  Schema,
  SchemaOrNull,
  SchemaStorage,
  StorageProxyWithProperties,
} from "../types.ts";
import type { Component } from "./Component.ts";

/** A ComponentInstance is the world-local representation of a component */
export class ComponentInstance<T extends SchemaOrNull> {
  /** The ComponentInstance's id */
  readonly id: number;

  /** The ComponentInstance's proxy */
  readonly proxy: T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;

  /** The ComponentInstance's storage */
  readonly storage: T extends Schema<infer U> ? SchemaStorage<U> : null;

  /** The ComponentInstance's prototype */
  readonly proto: Component<T>;

  /**
   * Create a new ComponentInstance
   * @param spec The ComponentInstance's specification
   * @throws {TypeError} If the spec is invalid
   */
  constructor(spec: ComponentInstanceSpec<T>) {
    const { id, proxy, storage, type } = spec;
    this.id = id;
    this.proxy = proxy as T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;
    this.storage = storage as T extends Schema<infer U> ? SchemaStorage<U> : null;
    this.proto = type;
    Object.freeze(this);
  }

  /** The ComponentInstance's name */
  get name(): string {
    return this.proto.name;
  }
}
