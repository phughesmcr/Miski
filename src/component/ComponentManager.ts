/**
 * @module      ComponentManager
 * @description A component manager is responsible for managing the components of a world.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_PARTITION_KEY } from "../constants.ts";
import { ComponentInstance } from "./ComponentInstance.ts";
import { isObject } from "../utils.ts";
import { StorageProxy } from "./StorageProxy.ts";
import type { Component } from "./Component.ts";
import type { Entity, SchemaOrNull, TypedArray } from "../types.ts";
import { NotRegisteredError } from "../errors.ts";
import type { ArchetypeManager } from "../archetype/ArchetypeManager.ts";

/** A component manager is responsible for managing the components of a world. */
export class ComponentManager {
  /** The storage buffer for the component manager */
  #buffer: PartitionedBuffer;
  /** The changed state for each component */
  #changed: Map<Component<any>, BooleanArray>;
  /** The owner state for each component */
  #owners: Map<Component<any>, BooleanArray>;
  /** The registry of component instances */
  #registry: Map<Component<any>, ComponentInstance<any>>;
  /** The registry of component instances by name */
  #registryByName: Record<string, ComponentInstance<any>>;
  /** Optional archetype manager for optimized entity component lookup */
  #archetypeManager?: ArchetypeManager | undefined;

  /**
   * Create a new component manager.
   * @param capacity - The capacity of the component manager
   * @param components - The components to register
   */
  constructor(capacity: number, components: Component<any>[]) {
    // create the storage buffer
    const size = components.reduce((acc, component) => acc + component.size, 0) * capacity;
    this.#buffer = new PartitionedBuffer(size, capacity);
    // create the various registries
    this.#changed = new Map();
    this.#owners = new Map();
    this.#registry = new Map();
    this.#registryByName = {};
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
      const proxy = storage ? new StorageProxy({ storage, changed: instanceChanged, capacity }) : null;
      // register component instance
      const instance = new ComponentInstance({ id: this.#registry.size, proxy, storage, type: component });
      this.#registry.set(component, instance);
      this.#registryByName[component.name] = instance;
    }
  }

  /** @returns the number of components registered */
  get count(): number {
    return this.#registry.size;
  }

  /** @returns a record of all component instances by name */
  get registry(): Record<string, ComponentInstance<any>> {
    return this.#registryByName;
  }

  /**
   * Add a component to an entity
   * @param component - The component to add to the entity
   * @param entity - The entity to add the component to
   * @param data - Optional data to set for the component
   * @returns The component instances for this entity
   */
  addToEntity = <T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
    data?: { [k in keyof T]: number },
  ): ComponentInstance<any>[] => {
    const instance = this.getInstance(component);
    if (!instance) {
      throw new NotRegisteredError(
        `Component ${typeof component === "string" ? `"${component}"` : component.name} not registered.`,
      );
    }
    const { type } = instance;

    // Set ownership
    const ownerState = this.#owners.get(type)?.set(entity, true);
    if (ownerState === undefined) {
      throw new Error(`Failed to set ownership for component ${type.name} on entity ${entity}.`);
    }

    // Set changed
    const changedState = this.#changed.get(type)?.set(entity, true);
    if (changedState === undefined) {
      throw new Error(`Failed to set changed state for component ${type.name} on entity ${entity}.`);
    }

    // Set data if provided
    if (isObject(data) && instance.storage !== null) {
      const storage = instance.storage?.partitions as Record<keyof T, TypedArray>;
      for (const key in data) {
        if (key in storage) {
          storage[key][entity] = data[key];
        }
      }
    }

    // Build component list directly from ownership (don't use archetype-dependent getEntityComponents)
    return this.#getEntityComponentsDirect(entity);
  };

  /**
   * Check if an entity has a component
   * @param component - The component to check for
   * @param entity - The entity to check for the component on
   * @returns `true` if the entity has the component, `false` otherwise
   */
  entityHas = <T extends SchemaOrNull<T>>(component: Component<T> | string, entity: Entity): boolean => {
    let proto;
    if (typeof component === "string") {
      proto = this.getInstance(component)?.type;
    } else {
      proto = component;
    }
    return proto ? this.#owners.get(proto)?.get(entity) ?? false : false;
  };

  /**
   * Get a component instance
   * @param component - The component to get the instance of
   * @returns The component instance or `undefined` if the component is not registered
   */
  getInstance = <T extends SchemaOrNull<T>>(component: Component<T> | string): ComponentInstance<T> | undefined => {
    if (typeof component === "string") {
      return this.#registryByName[component];
    }
    return this.#registry.get(component);
  };

  /**
   * Get instances for an array of components
   * @param array - The array of components to get instances for
   * @returns An array of component instances
   */
  getInstances = (array: Component<SchemaOrNull<any>>[]): (ComponentInstance<SchemaOrNull<any>> | undefined)[] => {
    return array.map(this.getInstance);
  };

  /**
   * Get an iterable of all entities with one or more changed properties for a given component
   * @param component The component to get changed entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getChanged = <T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined => {
    const instance = this.getInstance(component);
    if (!instance) return;
    return this.#changed.get(instance.type)?.truthyIndices() as IterableIterator<Entity> | undefined;
  };

  /**
   * Get an iterable of all entities with a given component
   * @param component The component to get entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getOwners = <T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined => {
    const instance = this.getInstance(component);
    if (!instance) return;
    return this.#owners.get(instance.type)?.truthyIndices() as IterableIterator<Entity> | undefined;
  };

  /**
   * Set the archetype manager for optimized component lookups
   * @param archetypeManager The archetype manager to use
   */
  setArchetypeManager(archetypeManager: ArchetypeManager): void {
    this.#archetypeManager = archetypeManager;
  }

  /**
   * Get all components for an entity directly from ownership tracking
   * This is used internally to avoid circular dependencies with the archetype system
   * @param entity The entity to get components for
   * @returns An array of component instances
   */
  #getEntityComponentsDirect(entity: Entity): ComponentInstance<any>[] {
    const components: ComponentInstance<any>[] = [];
    for (const [proto, instance] of this.#registry) {
      if (this.#owners.get(proto)?.get(entity)) {
        components.push(instance);
      }
    }
    return components;
  }

  /**
   * Get all components for an entity
   * @param entity The entity to get components for
   * @returns An array of component instances
   */
  getEntityComponents(entity: Entity): ComponentInstance<any>[] {
    // Fast path: use archetype if available
    if (this.#archetypeManager) {
      const archetype = this.#archetypeManager.getEntityArchetype(entity);
      if (archetype) {
        return archetype.components;
      }
      return [];
    }

    // Fallback: scan all components (slower)
    return this.#getEntityComponentsDirect(entity);
  }

  /**
   * Get the data for a component on an entity
   * @param component - The component to get the data for
   * @param entity - The entity to get the data for
   * @returns The data for the component or `undefined` if the component is not registered
   */
  getEntityData = <T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
  ): Record<keyof T, number> | undefined => {
    const instance = this.getInstance(component);
    if (!instance) {
      return undefined;
    }
    const storage = instance.storage?.partitions as Record<keyof T, TypedArray> | undefined;
    if (!storage) {
      return undefined;
    }
    const result: Record<keyof T, number> = {} as Record<keyof T, number>;
    for (const key in storage) {
      result[key] = storage[key][entity] ?? Number.NaN;
    }
    return result;
  };

  /**
   * Check if a component is registered
   * @param component - The component to check for
   * @returns `true` if the component is registered, `false` otherwise
   */
  isRegistered = (component: Component<any> | string): boolean => {
    return this.getInstance(component) !== undefined;
  };

  /**
   * Run routine maintenance on the component manager
   * @returns The component manager
   */
  refresh = (): ComponentManager => {
    for (const changed of this.#changed.values()) {
      changed.clear();
    }
    return this;
  };

  /**
   * Remove a component from an entity
   * @param component - The component to remove from the entity
   * @param entity - The entity to remove the component from
   * @returns The component instances for this entity
   */
  removeFromEntity = <T extends SchemaOrNull<T>>(
    component: string | Component<T>,
    entity: Entity,
  ): ComponentInstance<any>[] => {
    const instance = this.getInstance(component);
    if (!instance) return this.#getEntityComponentsDirect(entity);
    const { type } = instance;
    this.#owners.get(type)?.set(entity, false);
    this.#changed.get(type)?.set(entity, false);
    return this.#getEntityComponentsDirect(entity);
  };

  /**
   * Set the data for a component on an entity
   * @param component - The component to set the data for
   * @param entity - The entity to set the data for
   * @param value - The data to set for the component
   */
  setEntityData = <T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
    value: Record<keyof T, number>,
  ): this => {
    const instance = this.getInstance(component);
    if (!instance || !value) {
      return this;
    }
    const storage = instance.storage?.partitions as Record<keyof T, TypedArray> | undefined;
    if (!storage) {
      return this;
    }
    for (const key in value) {
      if (key in storage) {
        storage[key][entity] = value[key];
      }
    }
    return this;
  };

  /**
   * Stringify the component manager
   * @returns A string representation of the component manager
   */
  stringify = (): string => {
    return JSON.stringify(
      {
        buffer: this.#buffer.toString(),
        // TODO: serialize changed, owners, registry
      },
    );
  };
}
