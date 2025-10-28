/**
 * @module      ComponentManager
 * @description A component manager is responsible for managing the components of a world.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import { ComponentInstance } from "@/component/component-instance.ts";
import type { Component } from "@/component/component.ts";
import { StorageProxy } from "@/component/storage-proxy.ts";
import { $_PARTITION_KEY } from "@/shared/constants.ts";
import { BooleanArray, PartitionedBuffer } from "@/shared/deps.ts";
import { NotRegisteredError } from "@/shared/errors.ts";
import type { Entity, SchemaOrNull, TypedArray } from "@/shared/types.ts";
import { isObject } from "@/shared/utils.ts";

/**
 * Manages component registration, per-entity ownership, storage access, and change tracking.
 *
 * @remarks
 * - Each component has per-entity `owners` and `changed` bitsets for fast queries.
 * - `registry` maps component definitions to world-local {@link ComponentInstance} objects.
 * - When connected to an {@link ArchetypeManager}, `getEntityComponents` can return in O(1) via archetypes.
 */
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
   * Add a component to an entity.
   * @param component - The component to add to the entity.
   * @param entity - The entity to add the component to.
   * @param data - Optional initial data for the component's properties.
   * @returns The component instances for this entity.
   * @remarks Idempotent: if already owned, this is a no-op and does not mark changed or write data.
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

    // Idempotency: if already owned, no-op (do not mark changed, ignore data)
    const owners = this.#owners.get(type);
    if (!owners) {
      throw new Error(`Failed to read ownership for component ${type.name}.`);
    }
    if (owners.get(entity)) {
      return this.#getEntityComponentsDirect(entity);
    }

    // Enforce maxEntities if configured
    const limit = type.maxEntities;
    if (limit !== null) {
      const currentOwners = owners.getTruthyCount();
      if (currentOwners >= limit) {
        throw new RangeError(`Component ${type.name} exceeded maxEntities (${limit}).`);
      }
    }

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
    if (data !== undefined && isObject(data) && instance.storage !== null) {
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
  getInstances = (
    array: Component<SchemaOrNull<any>>[] | Readonly<Component<SchemaOrNull<any>>[]>,
  ): (ComponentInstance<SchemaOrNull<any>> | undefined)[] => {
    return array.map(this.getInstance);
  };

  /**
   * Get entities whose values changed for a component since the last refresh.
   * @param component - The component to inspect.
   * @returns An iterator of entities, or `undefined` if the component is not registered.
   */
  getChanged = <T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined => {
    const instance = this.getInstance(component);
    if (!instance) return;
    return this.#changed.get(instance.type)?.truthyIndices() as IterableIterator<Entity> | undefined;
  };

  /**
   * Get entities that currently own a component.
   * @param component - The component to inspect.
   * @returns An iterator of entities, or `undefined` if the component is not registered.
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
   * Get all components for an entity directly from ownership tracking.
   * Used internally to avoid archetype dependency.
   * @param entity - The entity to inspect.
   * @returns An array of component instances.
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
   * Get all components for an entity.
   * @param entity - The entity to inspect.
   * @returns An array of component instances.
   * @remarks Fast path via archetypes when available; falls back to scanning ownership.
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
   * Clear all per-component `changed` flags.
   * @returns This ComponentManager.
   */
  refresh = (): ComponentManager => {
    for (const changed of this.#changed.values()) {
      changed.clear();
    }
    return this;
  };

  /**
   * Remove a component from an entity.
   * @param component - The component to remove.
   * @param entity - The target entity.
   * @returns The component instances for this entity.
   * @remarks Idempotent: if not owned, this is a no-op.
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
    const changed = this.#changed.get(instance.type);
    for (const key in value) {
      if (key in storage) {
        const store = storage[key] as TypedArray;
        const next = value[key] as unknown as number;
        if (store[entity] !== next) {
          store[entity] = next;
          changed?.set(entity, true);
        }
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
