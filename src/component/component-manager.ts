/**
 * @module      ComponentManager
 * @description A component manager is responsible for managing the components of a world.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import type { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import { ReusableEntityIterator } from "@/entity/entity-list.ts";
import { NotRegisteredError } from "@/errors.ts";
import type { Entity, SchemaOrNull, TypedArray } from "@/types.ts";
import { isObject } from "@/utils.ts";
import { ComponentInstance } from "./component-instance.ts";
import { StorageProxy } from "./storage-proxy.ts";
import type { Component } from "./component.ts";

/** A component manager is responsible for managing the components of a world. */
export class ComponentManager {
  /** The storage buffer for the component manager */
  #buffer: PartitionedBuffer;
  /** The changed state for each component */
  #changed: Map<Component<any>, BooleanArray>;
  /** Changed state indexed by component instance id */
  #changedById: BooleanArray[];
  /** Owner count indexed by component instance id */
  #ownerCountsById: number[];
  /** Dense owner entity IDs for each component */
  #ownerLists: Map<Component<any>, Uint32Array>;
  /** Dense owner entity IDs indexed by component instance id */
  #ownerListsById: Uint32Array[];
  /** Reusable owner iterators for each component */
  #ownerIterators: Map<Component<any>, ReusableEntityIterator>;
  /** Reusable owner iterators indexed by component instance id */
  #ownerIteratorsById: ReusableEntityIterator[];
  /** Dense owner-list positions indexed by entity ID */
  #ownerPositions: Map<Component<any>, Uint32Array>;
  /** Dense owner-list positions indexed by component instance id, then entity ID */
  #ownerPositionsById: Uint32Array[];
  /** Byte ownership flags for each component, indexed by entity ID */
  #owners: Map<Component<any>, Uint8Array>;
  /** Byte ownership flags indexed by component instance id, then entity ID */
  #ownersById: Uint8Array[];
  /** The registry of component instances */
  #registry: Map<Component<any>, ComponentInstance<any>>;
  /** The registry of component instances by name */
  #registryByName: Record<string, ComponentInstance<any>>;
  /** Frozen public registry view keyed by component name */
  #publicRegistry: Readonly<Record<string, ComponentInstance<any>>>;
  /** Component instances indexed by component definition id */
  #registryByComponentId: ComponentInstance<any>[];
  /** Component instances indexed by component instance id */
  #instancesById: ComponentInstance<any>[];
  /** `true` for uncapped tag components, indexed by component id */
  #isUncappedTagById: boolean[];
  /** `true` for uncapped data components, indexed by component id */
  #isUncappedDataById: boolean[];
  /** Component max owner count, or 0 when uncapped, indexed by component id */
  #maxEntitiesById: number[];
  /** Whether component storage uses sparse non-typed-array partitions, indexed by component id */
  #usesSparseStorageById: boolean[];
  /** Optional archetype manager for optimized entity component lookup */
  #archetypeManager?: ArchetypeManager | undefined;

  /**
   * Create a new component manager.
   * @param capacity - The capacity of the component manager
   * @param components - The components to register
   */
  constructor(capacity: number, components: Component<any>[]) {
    // create the storage buffer
    const size = Math.max(components.reduce((acc, component) => acc + component.size, 0) * capacity, capacity);
    this.#buffer = new PartitionedBuffer(size, capacity);
    // create the various registries
    this.#changed = new Map();
    this.#changedById = [];
    this.#ownerCountsById = [];
    this.#ownerLists = new Map();
    this.#ownerListsById = [];
    this.#ownerIterators = new Map();
    this.#ownerIteratorsById = [];
    this.#ownerPositions = new Map();
    this.#ownerPositionsById = [];
    this.#owners = new Map();
    this.#ownersById = [];
    this.#registry = new Map();
    this.#registryByName = {};
    this.#publicRegistry = {};
    this.#registryByComponentId = [];
    this.#instancesById = [];
    this.#isUncappedTagById = [];
    this.#isUncappedDataById = [];
    this.#maxEntitiesById = [];
    this.#usesSparseStorageById = [];
    // register each component
    for (const component of components) {
      // instance owner entity tracking
      const instanceOwners = new Uint8Array(capacity);
      this.#owners.set(component, instanceOwners);
      const ownerList = new Uint32Array(capacity);
      this.#ownerLists.set(component, ownerList);
      const ownerIterator = new ReusableEntityIterator(ownerList);
      this.#ownerIterators.set(component, ownerIterator);
      this.#ownerPositions.set(component, new Uint32Array(capacity));
      // instance changed entity tracking
      const instanceChanged = new BooleanArray(capacity);
      this.#changed.set(component, instanceChanged);
      // instance storage
      const storage = this.#buffer.addPartition(component[$_PARTITION_KEY]);
      const proxy = storage ? new StorageProxy({ storage, changed: instanceChanged, capacity }) : null;
      // register component instance
      const instance = new ComponentInstance({ id: this.#registry.size, proxy, storage, type: component });
      const maxEntities = component.maxEntities;
      let usesSparseStorage = false;
      if (storage !== null) {
        const partitions = storage.partitions as Record<string, unknown>;
        for (const key in partitions) {
          if (!ArrayBuffer.isView(partitions[key] as ArrayBufferView)) {
            usesSparseStorage = true;
            break;
          }
        }
      }
      this.#changedById[instance.id] = instanceChanged;
      this.#ownerCountsById[instance.id] = 0;
      this.#ownerListsById[instance.id] = ownerList;
      this.#ownerIteratorsById[instance.id] = ownerIterator;
      this.#ownerPositionsById[instance.id] = this.#ownerPositions.get(component)!;
      this.#ownersById[instance.id] = instanceOwners;
      this.#instancesById[instance.id] = instance;
      this.#isUncappedTagById[instance.id] = storage === null && maxEntities === null;
      this.#isUncappedDataById[instance.id] = storage !== null && maxEntities === null;
      this.#maxEntitiesById[instance.id] = maxEntities ?? 0;
      this.#usesSparseStorageById[instance.id] = usesSparseStorage;
      this.#registry.set(component, instance);
      this.#registryByName[component.name] = instance;
      this.#registryByComponentId[component[$_COMPONENT_ID_KEY]] = instance;
    }
    this.#publicRegistry = Object.freeze({ ...this.#registryByName });
  }

  /** @returns the number of components registered */
  get count(): number {
    return this.#registry.size;
  }

  /** @returns a record of all component instances by name */
  get registry(): Readonly<Record<string, ComponentInstance<any>>> {
    return this.#publicRegistry;
  }

  /**
   * Add a component to an entity
   * @param component - The component to add to the entity
   * @param entity - The entity to add the component to
   * @param data - Optional data to set for the component
   * @returns `true` if the component ownership changed
   */
  addToEntity<T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
    data?: { [k in keyof T]: number },
  ): boolean {
    const instance = this.getInstance(component);
    if (!instance) {
      throw new NotRegisteredError(
        `Component ${typeof component === "string" ? `"${component}"` : component.name} not registered.`,
      );
    }
    return this.addInstanceToEntity(instance, entity, data);
  }

  /**
   * Add a registered component instance to an entity.
   * @param instance - The registered component instance
   * @param entity - The entity to add the component to
   * @param data - Optional data to set for the component
   * @returns `true` if the component ownership changed
   * @internal
   */
  addInstanceToEntity<T extends SchemaOrNull<T>>(
    instance: ComponentInstance<T>,
    entity: Entity,
    data?: { [k in keyof T]: number },
  ): boolean {
    const id = instance.id;
    const owners = this.#ownersById[id];
    if (owners === undefined) {
      throw new Error(`Failed to find ownership state for component ${instance.type.name}.`);
    }
    if (entity >= owners.length) {
      throw new RangeError(`Entity ${entity} is outside component capacity.`);
    }

    if (this.#isUncappedTagById[id]) {
      const alreadyOwned = owners[entity] === 1;
      if (!alreadyOwned) {
        const ownerCount = this.#ownerCountsById[id] ?? 0;
        this.#ownerListsById[id]![ownerCount] = entity;
        this.#ownerPositionsById[id]![entity] = ownerCount;
        this.#ownerCountsById[id] = ownerCount + 1;
        owners[entity] = 1;
      }
      return !alreadyOwned;
    }

    if (data === undefined && this.#isUncappedDataById[id]) {
      const alreadyOwned = owners[entity] === 1;
      if (!alreadyOwned) {
        const ownerCount = this.#ownerCountsById[id] ?? 0;
        this.#ownerListsById[id]![ownerCount] = entity;
        this.#ownerPositionsById[id]![entity] = ownerCount;
        this.#ownerCountsById[id] = ownerCount + 1;
        owners[entity] = 1;
      }
      return !alreadyOwned;
    }

    const alreadyOwned = owners[entity] === 1;
    const maxEntities = this.#maxEntitiesById[id] ?? 0;
    if (!alreadyOwned && maxEntities !== 0) {
      const ownerCount = this.#ownerCountsById[id] ?? 0;
      if (ownerCount >= maxEntities) {
        throw new RangeError(
          `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
        );
      }
    }

    // Set ownership
    owners[entity] = 1;
    if (!alreadyOwned) {
      const ownerCount = this.#ownerCountsById[id] ?? 0;
      const ownerList = this.#ownerListsById[id];
      const ownerPositions = this.#ownerPositionsById[id];
      if (ownerList === undefined || ownerPositions === undefined) {
        throw new Error(`Failed to find dense ownership state for component ${instance.type.name}.`);
      }
      ownerList[ownerCount] = entity;
      ownerPositions[entity] = ownerCount;
      this.#ownerCountsById[id] = ownerCount + 1;
    }

    const storage = instance.storage;
    const hasData = isObject(data);
    if (storage !== null && hasData) {
      const changedState = this.#changedById[id]?.set(entity, true);
      if (changedState === undefined) {
        throw new Error(`Failed to set changed state for component ${instance.type.name} on entity ${entity}.`);
      }
    }

    // Set data if provided
    if (hasData && storage !== null) {
      const partitions = storage.partitions as Record<keyof T, TypedArray>;
      for (const key in data) {
        if (key in partitions) {
          partitions[key][entity] = data[key];
        }
      }
    }

    return !alreadyOwned;
  }

  /**
   * Check if an entity has a component
   * @param component - The component to check for
   * @param entity - The entity to check for the component on
   * @returns `true` if the entity has the component, `false` otherwise
   */
  entityHas<T extends SchemaOrNull<T>>(component: Component<T> | string, entity: Entity): boolean {
    let proto;
    if (typeof component === "string") {
      proto = this.getInstance(component)?.type;
    } else {
      proto = component;
    }
    const instance = proto ? this.#registryByComponentId[proto[$_COMPONENT_ID_KEY]] : undefined;
    return instance ? this.#ownersById[instance.id]?.[entity] === 1 : false;
  }

  /**
   * Get a component instance
   * @param component - The component to get the instance of
   * @returns The component instance or `undefined` if the component is not registered
   */
  getInstance<T extends SchemaOrNull<T>>(component: Component<T> | string): ComponentInstance<T> | undefined {
    if (typeof component === "string") {
      return this.#registryByName[component];
    }
    return this.#registryByComponentId[component[$_COMPONENT_ID_KEY]];
  }

  /**
   * Get instances for an array of components
   * @param array - The array of components to get instances for
   * @returns An array of component instances
   */
  getInstances(
    array: Component<SchemaOrNull<any>>[] | Readonly<Component<SchemaOrNull<any>>[]>,
  ): (ComponentInstance<SchemaOrNull<any>> | undefined)[] {
    return array.map((component) => this.getInstance(component));
  }

  /**
   * Get an iterable of all entities with one or more changed properties for a given component
   * @param component The component to get changed entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getChanged<T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined {
    const instance = this.getInstance(component);
    if (!instance) return;
    return this.#changedById[instance.id]?.truthyIndices() as IterableIterator<Entity> | undefined;
  }

  /**
   * Get an iterable of all entities with a given component
   * @param component The component to get entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getOwners<T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined {
    const instance = this.getInstance(component);
    if (!instance) return;
    return this.#ownerIteratorsById[instance.id]?.reset(this.#ownerCountsById[instance.id] ?? 0);
  }

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
    for (let i = 0; i < this.#instancesById.length; i++) {
      const instance = this.#instancesById[i]!;
      if (this.#ownersById[i]?.[entity] === 1) {
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
  getEntityData<T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
  ): Record<keyof T, number> | undefined {
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
  }

  /**
   * Check if a component is registered
   * @param component - The component to check for
   * @returns `true` if the component is registered, `false` otherwise
   */
  isRegistered(component: Component<any> | string): boolean {
    return this.getInstance(component) !== undefined;
  }

  /**
   * Run routine maintenance on the component manager
   * @returns The component manager
   */
  refresh(): ComponentManager {
    for (let i = 0; i < this.#changedById.length; i++) {
      this.#changedById[i]!.clear();
    }
    return this;
  }

  /**
   * Remove a component from an entity
   * @param component - The component to remove from the entity
   * @param entity - The entity to remove the component from
   * @returns `true` if the component ownership changed, or `undefined` if the component is not registered
   */
  removeFromEntity<T extends SchemaOrNull<T>>(
    component: string | Component<T>,
    entity: Entity,
  ): boolean | undefined {
    const instance = this.getInstance(component);
    if (!instance) return undefined;
    return this.removeInstanceFromEntity(instance, entity);
  }

  /**
   * Remove a registered component instance from an entity.
   * @param instance - The registered component instance
   * @param entity - The entity to remove the component from
   * @returns `true` if the component ownership changed
   * @internal
   */
  removeInstanceFromEntity<T extends SchemaOrNull<T>>(
    instance: ComponentInstance<T>,
    entity: Entity,
  ): boolean {
    const id = instance.id;
    const owners = this.#ownersById[id];
    const wasOwned = owners?.[entity] === 1;
    if (this.#isUncappedTagById[id]) {
      if (wasOwned) {
        const ownerCount = this.#ownerCountsById[id] ?? 1;
        const ownerList = this.#ownerListsById[id]!;
        const ownerPositions = this.#ownerPositionsById[id]!;
        const removeIndex = ownerPositions[entity]!;
        const lastIndex = ownerCount - 1;
        const lastEntity = ownerList[lastIndex]!;
        if (removeIndex !== lastIndex) {
          ownerList[removeIndex] = lastEntity;
          ownerPositions[lastEntity] = removeIndex;
        }
        ownerList[lastIndex] = 0;
        ownerPositions[entity] = 0;
        this.#ownerCountsById[id] = lastIndex;
        owners![entity] = 0;
      }
      return wasOwned;
    }

    if (wasOwned) {
      const ownerCount = this.#ownerCountsById[id] ?? 1;
      const ownerList = this.#ownerListsById[id];
      const ownerPositions = this.#ownerPositionsById[id];
      if (ownerList === undefined || ownerPositions === undefined) {
        throw new Error(`Failed to find dense ownership state for component ${instance.type.name}.`);
      }
      const removeIndex = ownerPositions[entity]!;
      const lastIndex = ownerCount - 1;
      const lastEntity = ownerList[lastIndex]!;
      if (removeIndex !== lastIndex) {
        ownerList[removeIndex] = lastEntity;
        ownerPositions[lastEntity] = removeIndex;
      }
      ownerList[lastIndex] = 0;
      ownerPositions[entity] = 0;
      this.#ownerCountsById[id] = lastIndex;
    }
    if (owners !== undefined && entity < owners.length) {
      owners[entity] = 0;
    }
    const storage = instance.storage;
    if (storage !== null) {
      this.#changedById[id]?.set(entity, false);
    }
    if (wasOwned && storage !== null && this.#usesSparseStorageById[id]) {
      const partitions = storage.partitions as Record<string, TypedArray>;
      for (const key in partitions) {
        const partition = partitions[key];
        if (partition && !ArrayBuffer.isView(partition)) {
          Reflect.deleteProperty(partition, String(entity));
        }
      }
    }
    return wasOwned;
  }

  /**
   * Set the data for a component on an entity
   * @param component - The component to set the data for
   * @param entity - The entity to set the data for
   * @param value - The data to set for the component
   */
  setEntityData<T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
    value: Record<keyof T, number>,
  ): this {
    const instance = this.getInstance(component);
    if (!instance || !value) {
      return this;
    }
    const storage = instance.storage?.partitions as Record<keyof T, TypedArray> | undefined;
    if (!storage) {
      return this;
    }
    let changed = false;
    for (const key in value) {
      if (key in storage) {
        changed ||= storage[key][entity] !== value[key];
        storage[key][entity] = value[key];
      }
    }
    if (changed && this.#ownersById[instance.id]?.[entity] === 1) {
      const changedState = this.#changedById[instance.id]?.set(entity, true);
      if (changedState === undefined) {
        throw new Error(`Failed to set changed state for component ${instance.type.name} on entity ${entity}.`);
      }
    }
    return this;
  }

  /**
   * Stringify the component manager
   * @returns A string representation of the component manager
   */
  stringify(): string {
    return JSON.stringify(
      {
        buffer: this.#buffer.toString(),
        // TODO: serialize changed, owners, registry
      },
    );
  }
}
