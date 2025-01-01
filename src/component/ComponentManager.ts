/**
 * @module      ComponentManager
 * @description A component manager is responsible for managing the components of a world.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { $_PARTITION_KEY } from "../constants.ts";
import { BooleanArray } from "@phughesmcr/booleanarray";
import { ComponentInstance } from "./ComponentInstance.ts";
import { isObject } from "../utils.ts";
import { PartitionedBuffer } from "@phughesmcr/partitionedbuffer";
import { StorageProxy } from "./StorageProxy.ts";
import type { Component } from "./Component.ts";
import type { Entity, SchemaOrNull, TypedArray } from "../types.ts";

/** A component manager is responsible for managing the components of a world. */
export class ComponentManager {
  #buffer: PartitionedBuffer;
  #changed: Map<Component<any>, BooleanArray>;
  #owners: Map<Component<any>, BooleanArray>;
  #registry: Map<Component<any>, ComponentInstance<any>>;

  /**
   * Create a new component manager.
   * @param capacity The capacity of the component manager
   * @param components The components to register
   */
  constructor(capacity: number, components: Component<any>[]) {
    // create the storage buffer
    const size = components.reduce((acc, component) => acc + component.size, 0) * capacity;
    this.#buffer = new PartitionedBuffer(size, capacity);
    // create the various registries
    this.#changed = new Map();
    this.#owners = new Map();
    this.#registry = new Map();
    // register each component
    for (const component of components) {
      // instance owner entity tracking
      const instanceOwners = new BooleanArray(capacity);
      this.#owners.set(component, instanceOwners);
      // instance changed entity tracking
      const instanceChanged = new BooleanArray(capacity);
      this.#changed.set(component, instanceChanged);
      // instance storage
      const storage = this.#buffer.addPartition(component[$_PARTITION_KEY]);
      const proxy = storage ? new StorageProxy({ storage, changed: instanceChanged }) : null;
      // register component instance
      const instance = new ComponentInstance({ id: this.#registry.size, proxy, storage, type: component });
      this.#registry.set(component, instance);
    }
  }

  /**
   * @returns an iterable of all component instances
   */
  get all(): IterableIterator<ComponentInstance<any>> {
    return this.#registry.values();
  }

  get count(): number {
    return this.#registry.size;
  }

  addToEntity<T extends SchemaOrNull>(
    entity: Entity,
    component: Component<T>,
    data?: { [k in keyof T]: number },
  ): ComponentManager {
    const instance = this.get(component);
    if (!instance) {
      throw new Error(`Component "${component.name}" not registered.`);
    }
    const ownerState = this.#owners.get(component)?.setBool(entity, true);
    if (ownerState === undefined) {
      throw new Error(`Error setting owner state for component "${component.name}".`);
    }
    const changedState = this.#changed.get(component)?.setBool(entity, true);
    if (changedState === undefined) {
      throw new Error(`Error setting changed state for component "${component.name}".`);
    }
    const storage = instance.storage?.partitions as Record<keyof T, TypedArray>;
    if (storage && isObject(data)) {
      for (const key in data) {
        if (key in storage) {
          storage[key][entity] = data[key];
        }
      }
    }
    return this;
  }

  get(component: Component<any> | string): ComponentInstance<any> | undefined {
    if (typeof component === "string") {
      const instance = this.#registry.keys().find((key) => key.name === component);
      if (instance === undefined) {
        return undefined;
      }
      return this.#registry.get(instance);
    }
    return this.#registry.get(component);
  }

  isRegistered(component: Component<any> | string): boolean {
    return this.get(component) !== undefined;
  }

  /**
   * Run routine maintenance on the component manager
   * @returns The component manager
   */
  refresh(): ComponentManager {
    for (const changed of this.#changed.values()) {
      changed.fill(0);
    }
    return this;
  }

  stringify(): string {
    return JSON.stringify(
      {
        buffer: this.#buffer.toString(),
        // TODO: serialise changed, owners, registry
      },
    );
  }
}
