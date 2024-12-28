/**
 * @module      ComponentInstance
 * @description A component instance is the world-local representation of a component.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Schema, SchemaOrNull } from "../types.ts";
import type { Component } from "./Component.ts";

export class ComponentInstance<T extends SchemaOrNull> {
  readonly id: number;
  readonly proxy: T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;
  readonly storage: T extends Schema<infer U> ? SchemaStorage<U> : null;
  readonly type: Component<T>;

  private constructor(spec: ComponentInstanceSpec<T>) {
    const { id, proxy, storage, type } = spec;
    this.id = id;
    this.proxy = proxy as T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;
    this.storage = storage as T extends Schema<infer U> ? SchemaStorage<U> : null;
    this.type = type;
  }
}
