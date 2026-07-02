/**
 * @module      ComponentManager
 * @description A component manager is responsible for managing the components of a world.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { getPartitionByteSize, PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import { createEntityArray, type EntityArray } from "@/entity/entity-array.ts";
import { ReusableEntityIterator } from "@/entity/entity-list.ts";
import { componentDisplayName, formatComponentNotRegistered, NotRegisteredError } from "@/errors.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import type { Entity } from "@/entity/entity-id.ts";
import type { ComponentData, SchemaOrNull, TypedArray } from "@/types/partitions.ts";
import { isObject } from "@/utils.ts";
import { ComponentInstance } from "./component-instance.ts";
import { StorageProxy } from "./storage-proxy.ts";
import type { Component } from "./component.ts";

function roundUpToMultiple(value: number, multiple: number): number {
  const remainder = value % multiple;
  return remainder === 0 ? value : value + multiple - remainder;
}

function getComponentStorageSize(component: DynamicComponent, capacity: number): number {
  const schema = component[$_PARTITION_KEY].schema;
  if (schema === null) return 0;
  return getPartitionByteSize(schema, component.maxEntities ?? capacity);
}

/** A preflighted bundle entry ready for component-manager commit. */
export type ComponentBundleCommitEntry = {
  /** The registered component instance to add or update. */
  readonly instance: DynamicComponentInstance;
  /** Optional numeric data to merge into component storage. */
  readonly data: Partial<Record<string, number>> | undefined;
};

/**
 * A component manager owns component registration, storage, ownership flags, owner iteration, and changed tracking.
 *
 * World-level mutation semantics live in `World`: active-entity validation, archetype transitions, and query-cache
 * invalidation must happen before/after calling the registered-instance methods on this manager.
 */
export class ComponentManager {
  /** The storage buffer for the component manager */
  #buffer: PartitionedBuffer;
  /** The maximum number of entities this manager can track */
  #capacity: number;
  /** Changed state indexed by component instance id */
  #changedById: (BooleanArray | undefined)[];
  /** Number of changed entities indexed by component instance id */
  #changedCountsById: number[];
  /** Dense changed entity IDs indexed by component instance id */
  #changedListsById: (EntityArray | undefined)[];
  /** Reusable changed iterators indexed by component instance id */
  #changedIteratorsById: (ReusableEntityIterator | undefined)[];
  /** Dense changed-list positions indexed by component instance id, then entity ID */
  #changedPositionsById: (EntityArray | undefined)[];
  /** Shared empty changed iterator returned for tag components */
  #emptyChangedIterator: ReusableEntityIterator;
  /** Shared empty owner iterator returned for components with no owners */
  #emptyOwnerIterator: ReusableEntityIterator;
  /** Owner count indexed by component instance id */
  #ownerCountsById: number[];
  /** Dense owner entity IDs indexed by component instance id */
  #ownerListsById: (EntityArray | undefined)[];
  /** Reusable owner iterators indexed by component instance id */
  #ownerIteratorsById: (ReusableEntityIterator | undefined)[];
  /** Dense owner-list positions indexed by component instance id, then entity ID */
  #ownerPositionsById: (EntityArray | undefined)[];
  /** Byte ownership flags indexed by component instance id, then entity ID */
  #ownersById: (Uint8Array | undefined)[];
  /** The registry of component instances */
  #registry: Map<DynamicComponent, DynamicComponentInstance>;
  /** The registry of component instances by name */
  #registryByName: Record<string, DynamicComponentInstance>;
  /** Frozen public registry view keyed by component name */
  #publicRegistry: Readonly<Record<string, DynamicComponentInstance>>;
  /** Component instances indexed by component definition id */
  #registryByComponentId: DynamicComponentInstance[];
  /** Component instances indexed by component instance id */
  #instancesById: DynamicComponentInstance[];
  /** `true` for uncapped tag components, indexed by component id */
  #isUncappedTagById: boolean[];
  /** `true` for uncapped data components, indexed by component id */
  #isUncappedDataById: boolean[];
  /** Component max owner count, or 0 when uncapped, indexed by component id */
  #maxEntitiesById: number[];
  /** Whether component storage uses sparse non-typed-array partitions, indexed by component id */
  #usesSparseStorageById: boolean[];

  /**
   * Create a new component manager.
   * @param capacity - The capacity of the component manager
   * @param components - The components to register
   */
  constructor(capacity: number, components: DynamicComponent[]) {
    // create the storage buffer
    const storageSize = components.reduce((acc, component) => acc + getComponentStorageSize(component, capacity), 0);
    const size = roundUpToMultiple(Math.max(storageSize, capacity), capacity);
    this.#buffer = new PartitionedBuffer(size, capacity);
    this.#capacity = capacity;
    // create the various registries
    this.#changedById = [];
    this.#changedCountsById = [];
    this.#changedListsById = [];
    this.#changedIteratorsById = [];
    this.#changedPositionsById = [];
    this.#emptyChangedIterator = new ReusableEntityIterator(createEntityArray(0));
    this.#emptyOwnerIterator = new ReusableEntityIterator(createEntityArray(0));
    this.#ownerCountsById = [];
    this.#ownerListsById = [];
    this.#ownerIteratorsById = [];
    this.#ownerPositionsById = [];
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
      const maxEntities = component.maxEntities;
      // instance storage
      const storage = this.#buffer.addPartition(component[$_PARTITION_KEY]);
      const instanceId = this.#registry.size;
      const proxy = storage ?
        new StorageProxy({
          storage,
          markChanged: (entity: Entity) => this.#markChanged(instanceId, entity),
          capacity,
        }) :
        null;
      // register component instance
      const instance = new ComponentInstance({
        id: instanceId,
        has: (entity: Entity): boolean => this.#ownersById[instanceId]?.[entity] === 1,
        markChanged: (entity: Entity): boolean => this.#markInstanceIdChanged(instanceId, entity),
        proxy,
        storage,
        type: component,
      });
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
      this.#changedCountsById[instance.id] = 0;
      this.#ownerCountsById[instance.id] = 0;
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
  get registry(): Readonly<Record<string, DynamicComponentInstance>> {
    return this.#publicRegistry;
  }

  /** Get the dense list capacity needed for a component's owner/changed lists. */
  #getListCapacity(instanceId: number): number {
    const maxEntities = this.#maxEntitiesById[instanceId] ?? 0;
    return Math.min(maxEntities === 0 ? this.#capacity : maxEntities, this.#capacity);
  }

  /** Allocate ownership tracking for a component only when it first gains an owner. */
  #ensureOwnershipState(instanceId: number): Uint8Array {
    let owners = this.#ownersById[instanceId];
    if (owners !== undefined) return owners;

    const ownerList = createEntityArray(this.#capacity, this.#getListCapacity(instanceId));
    owners = new Uint8Array(this.#capacity);
    this.#ownersById[instanceId] = owners;
    this.#ownerListsById[instanceId] = ownerList;
    this.#ownerPositionsById[instanceId] = createEntityArray(this.#capacity);
    this.#ownerIteratorsById[instanceId] = new ReusableEntityIterator(ownerList);
    return owners;
  }

  /** Append an entity to a component's dense owner list. */
  #appendOwner(instanceId: number, entity: Entity): void {
    const ownerCount = this.#ownerCountsById[instanceId] ?? 0;
    const ownerList = this.#ownerListsById[instanceId]!;
    const ownerPositions = this.#ownerPositionsById[instanceId]!;
    ownerList[ownerCount] = entity;
    ownerPositions[entity] = ownerCount;
    this.#ownerCountsById[instanceId] = ownerCount + 1;
  }

  /** Remove an entity from a dense list whose membership was already checked. */
  #removeFromDenseList(list: EntityArray, positions: EntityArray, count: number, entity: Entity): number {
    const removeIndex = positions[entity]!;
    const lastIndex = count - 1;
    const lastEntity = list[lastIndex]!;
    if (removeIndex !== lastIndex) {
      list[removeIndex] = lastEntity;
      positions[lastEntity] = removeIndex;
    }
    list[lastIndex] = 0;
    positions[entity] = 0;
    return lastIndex;
  }

  /**
   * Claim ownership for an entity when it is not already owned.
   * @returns `true` when ownership changed from unowned to owned
   */
  #acquireOwnership(instanceId: number, entity: Entity, owners: Uint8Array): boolean {
    const alreadyOwned = owners[entity] === 1;
    if (alreadyOwned) return false;
    owners[entity] = 1;
    this.#appendOwner(instanceId, entity);
    return true;
  }

  /** Allocate changed tracking for data components only when a write marks them changed. */
  #ensureChangedState(instanceId: number): BooleanArray | undefined {
    let changed = this.#changedById[instanceId];
    if (changed !== undefined) return changed;

    const instance = this.#instancesById[instanceId];
    if (instance === undefined || instance.storage === null) return undefined;

    const changedList = createEntityArray(this.#capacity, this.#getListCapacity(instanceId));
    changed = new BooleanArray(this.#capacity);
    this.#changedById[instanceId] = changed;
    this.#changedListsById[instanceId] = changedList;
    this.#changedPositionsById[instanceId] = createEntityArray(this.#capacity);
    this.#changedIteratorsById[instanceId] = new ReusableEntityIterator(changedList);
    return changed;
  }

  /** Mark a data component changed once per entity per refresh window. */
  #markChanged(instanceId: number, entity: Entity): void {
    const changed = this.#ensureChangedState(instanceId);
    if (changed === undefined || changed.get(entity)) return;

    const changedList = this.#changedListsById[instanceId];
    const changedPositions = this.#changedPositionsById[instanceId];
    if (changedList === undefined || changedPositions === undefined) {
      throw new Error(`Failed to find dense changed state for component id ${instanceId}.`);
    }

    const changedCount = this.#changedCountsById[instanceId] ?? 0;
    changed.set(entity, true);
    changedList[changedCount] = entity;
    changedPositions[entity] = changedCount;
    this.#changedCountsById[instanceId] = changedCount + 1;
  }

  /** Mark a data component changed by instance id if the entity owns it. */
  #markInstanceIdChanged(instanceId: number, entity: Entity): boolean {
    const instance = this.#instancesById[instanceId];
    if (instance === undefined || instance.storage === null) return false;
    if (this.#ownersById[instanceId]?.[entity] !== 1) return false;
    this.#markChanged(instanceId, entity);
    return true;
  }

  /** Remove a data component from changed iteration if present. */
  #unmarkChanged(instanceId: number, entity: Entity): void {
    const changed = this.#changedById[instanceId];
    if (changed === undefined || !changed.get(entity)) return;

    const changedList = this.#changedListsById[instanceId];
    const changedPositions = this.#changedPositionsById[instanceId];
    if (changedList === undefined || changedPositions === undefined) {
      throw new Error(`Failed to find dense changed state for component id ${instanceId}.`);
    }

    const changedCount = this.#changedCountsById[instanceId] ?? 1;
    this.#changedCountsById[instanceId] = this.#removeFromDenseList(
      changedList,
      changedPositions,
      changedCount,
      entity,
    );
    changed.set(entity, false);
  }

  /**
   * Add a registered component instance to an entity.
   *
   * This updates only component ownership/data/changed state. Callers that expose world-level mutations must handle
   * entity liveness, archetype transitions, and query-cache invalidation separately.
   *
   * @param instance - The registered component instance
   * @param entity - The entity to add the component to
   * @param data - Optional data to set for the component
   * @returns `true` if the component ownership changed
   * @internal
   */
  addInstanceToEntity<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
    data?: Partial<Record<keyof TValue, number>>,
  ): boolean {
    const id = instance.id;
    if (entity >= this.#capacity) {
      throw new RangeError(`Entity ${entity} is outside component capacity.`);
    }
    const owners = this.#ensureOwnershipState(id);

    if (this.#isUncappedTagById[id] || (data === undefined && this.#isUncappedDataById[id])) {
      return this.#acquireOwnership(id, entity, owners);
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

    const ownershipChanged = this.#acquireOwnership(id, entity, owners);

    const storage = instance.storage;
    const hasData = isObject(data);
    if (storage !== null && hasData) {
      this.#markChanged(id, entity);
    }

    // Set data if provided
    if (hasData && storage !== null) {
      const partitions = storage.partitions as Record<string, TypedArray>;
      for (const key in data) {
        const value = data[key];
        if (value !== undefined && key in partitions) {
          partitions[key]![entity] = value;
        }
      }
    }

    return ownershipChanged;
  }

  /**
   * Check if an entity has a component
   * @param component - The component to check for
   * @param entity - The entity to check for the component on
   * @returns `true` if the entity has the component, `false` otherwise
   */
  entityHas<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string, entity: Entity): boolean {
    const instance = this.getInstance(component);
    return instance ? this.#ownersById[instance.id]?.[entity] === 1 : false;
  }

  /**
   * Check if an entity owns a registered component instance.
   * @param instance - The registered component instance
   * @param entity - The entity to check
   * @returns `true` if the entity owns the component instance
   * @internal
   */
  entityOwnsInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(instance: ComponentInstance<TValue, TStorage>, entity: Entity): boolean {
    return this.#ownersById[instance.id]?.[entity] === 1;
  }

  /**
   * Mark a registered data component instance as changed if the entity owns it.
   * @param instance - The registered component instance
   * @param entity - The entity to mark
   * @returns `true` when an owning data component was marked, otherwise `false`
   * @internal
   */
  markInstanceChanged<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(instance: ComponentInstance<TValue, TStorage>, entity: Entity): boolean {
    return this.#markInstanceIdChanged(instance.id, entity);
  }

  /**
   * Get a component instance
   * @param component - The component to get the instance of
   * @returns The component instance or `undefined` if the component is not registered
   */
  getInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): ComponentInstance<TValue, TStorage> | undefined {
    if (typeof component === "string") {
      return this.#registryByName[component] as ComponentInstance<TValue, TStorage> | undefined;
    }
    return this.#registryByComponentId[component[$_COMPONENT_ID_KEY]] as
      | ComponentInstance<TValue, TStorage>
      | undefined;
  }

  /**
   * Get a registered component instance
   * @param component - The component to get the instance of
   * @returns The component instance
   * @throws {NotRegisteredError} If the component is not registered
   */
  require<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): ComponentInstance<TValue, TStorage> {
    const instance = this.getInstance(component);
    if (!instance) {
      throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component)));
    }
    return instance;
  }

  /**
   * Get instances for an array of components
   * @param array - The array of components to get instances for
   * @returns An array of component instances
   */
  getInstances(
    array: DynamicComponent[] | Readonly<DynamicComponent[]>,
  ): (DynamicComponentInstance | undefined)[] {
    return array.map((component) => this.getInstance(component));
  }

  /**
   * Get an iterable of all entities with one or more changed properties for a given component
   * @param component The component to get changed entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getChanged<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): IterableIterator<Entity> | undefined {
    const instance = this.getInstance(component);
    if (!instance) return;
    const iterator = this.#changedIteratorsById[instance.id];
    if (iterator === undefined) return this.#emptyChangedIterator.reset(0);
    return iterator.reset(this.#changedCountsById[instance.id] ?? 0);
  }

  /**
   * Get an iterable of all entities with a given component
   * @param component The component to get entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getOwners<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): IterableIterator<Entity> | undefined {
    const instance = this.getInstance(component);
    if (!instance) return;
    return (this.#ownerIteratorsById[instance.id] ?? this.#emptyOwnerIterator).reset(
      this.#ownerCountsById[instance.id] ?? 0,
    );
  }

  /** Get the current owner count for a registered component instance. */
  getInstanceOwnerCount<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(instance: ComponentInstance<TValue, TStorage>): number {
    return this.#ownerCountsById[instance.id] ?? 0;
  }

  /** Get the owner limit for a registered component instance, or `null` when uncapped. */
  getInstanceMaxEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(instance: ComponentInstance<TValue, TStorage>): number | null {
    const maxEntities = this.#maxEntitiesById[instance.id] ?? 0;
    return maxEntities === 0 ? null : maxEntities;
  }

  /**
   * Preflight capacity for adding a set of registered component instances to one entity.
   * @param entries - Unique registered component instances and optional data
   * @param entity - The target entity
   * @throws {RangeError} If the entity is out of component capacity or any max owner count would overflow
   * @internal
   */
  preflightAddBundleToEntity(entries: readonly ComponentBundleCommitEntry[], entity: Entity): void {
    if (entity >= this.#capacity) {
      throw new RangeError(`Entity ${entity} is outside component capacity.`);
    }
    for (let i = 0; i < entries.length; i++) {
      const instance = entries[i]!.instance;
      if (this.entityOwnsInstance(instance, entity)) continue;
      const maxEntities = this.getInstanceMaxEntities(instance);
      if (maxEntities === null) continue;
      const ownerCount = this.getInstanceOwnerCount(instance);
      if (ownerCount >= maxEntities) {
        throw new RangeError(
          `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
        );
      }
    }
  }

  /**
   * Commit a preflighted set of component additions/upserts for one entity.
   * @param entries - Unique registered component instances and optional data
   * @param entity - The target entity
   * @returns Component instances whose ownership changed from unowned to owned
   * @internal
   */
  addBundleToEntity(entries: readonly ComponentBundleCommitEntry[], entity: Entity): DynamicComponentInstance[] {
    const added: DynamicComponentInstance[] = [];
    for (let i = 0; i < entries.length; i++) {
      const { data, instance } = entries[i]!;
      if (
        this.addInstanceToEntity(
          instance,
          entity,
          data as Partial<Record<PropertyKey, number>> | undefined,
        )
      ) {
        added.push(instance);
      }
    }
    return added;
  }

  /**
   * Get all components for an entity directly from ownership tracking
   * This is used internally to avoid circular dependencies with the archetype system
   * @param entity The entity to get components for
   * @returns An array of component instances
   */
  getEntityComponents(entity: Entity): DynamicComponentInstance[] {
    const components: DynamicComponentInstance[] = [];
    for (let i = 0; i < this.#instancesById.length; i++) {
      const instance = this.#instancesById[i]!;
      if (this.#ownersById[i]?.[entity] === 1) {
        components.push(instance);
      }
    }
    return components;
  }

  /**
   * Get the data for a registered data component instance on an entity.
   *
   * This reads raw storage by entity id. Callers that expose public data access must verify entity liveness, component
   * registration, data storage, and ownership separately.
   *
   * @param instance - The registered component instance
   * @param entity - The entity to get the data for
   * @returns The data for the component or `undefined` if the instance has no storage
   * @internal
   */
  getInstanceEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
  ): ComponentData<TValue> | undefined {
    const storage = instance.storage?.partitions as Record<string, TypedArray> | undefined;
    if (!storage) return undefined;
    const result: Record<string, number> = {};
    for (const key in storage) {
      result[key] = storage[key]![entity] ?? Number.NaN;
    }
    return result as ComponentData<TValue>;
  }

  /**
   * Copy a registered data component instance's entity data into a caller-owned object.
   *
   * This reads raw storage by entity id. Callers that expose public data access must verify entity liveness and
   * component registration separately. Non-owners and tag components return `false` without mutating `out`.
   *
   * @param instance - The registered component instance
   * @param entity - The entity to read
   * @param out - Caller-owned object to overwrite
   * @returns `true` if all component keys were written into `out`
   * @internal
   */
  getInstanceEntityDataInto<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
    out: Partial<ComponentData<TValue>>,
  ): boolean {
    const storage = instance.storage?.partitions as Record<string, TypedArray> | undefined;
    if (!storage) return false;
    if (!this.entityOwnsInstance(instance, entity)) return false;
    const target = out as Record<string, number>;
    for (const key in storage) {
      target[key] = storage[key]![entity] ?? Number.NaN;
    }
    return true;
  }

  /**
   * Check if a component is registered
   * @param component - The component to check for
   * @returns `true` if the component is registered, `false` otherwise
   */
  isRegistered(component: DynamicComponent | string): boolean {
    return this.getInstance(component) !== undefined;
  }

  /**
   * Run routine maintenance on the component manager
   * @returns The component manager
   */
  refresh(): ComponentManager {
    for (let i = 0; i < this.#changedById.length; i++) {
      this.#changedById[i]?.clear();
      this.#changedCountsById[i] = 0;
    }
    return this;
  }

  /**
   * Remove a registered component instance from an entity.
   *
   * This updates only component ownership/data/changed state. Callers that expose world-level mutations must handle
   * entity liveness, archetype transitions, and query-cache invalidation separately.
   *
   * @param instance - The registered component instance
   * @param entity - The entity to remove the component from
   * @returns `true` if the component ownership changed
   * @internal
   */
  removeInstanceFromEntity<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
  ): boolean {
    const id = instance.id;
    const owners = this.#ownersById[id];
    const wasOwned = owners?.[entity] === 1;
    if (!wasOwned) return false;

    const ownerList = this.#ownerListsById[id]!;
    const ownerPositions = this.#ownerPositionsById[id]!;
    const ownerCount = this.#ownerCountsById[id] ?? 1;
    this.#ownerCountsById[id] = this.#removeFromDenseList(ownerList, ownerPositions, ownerCount, entity);

    if (owners !== undefined && entity < owners.length) {
      owners[entity] = 0;
    }
    const storage = instance.storage;
    if (storage !== null) {
      this.#unmarkChanged(id, entity);
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
   * Set data for a registered data component instance on an entity.
   *
   * This writes raw storage by entity id. Callers that expose public data mutation must verify entity liveness,
   * component registration, data storage, and ownership separately.
   *
   * @param instance - The registered component instance
   * @param entity - The entity to set the data for
   * @param value - The data to set
   * @returns This component manager
   * @internal
   */
  setInstanceEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
    value: Partial<Record<keyof TValue, number>>,
  ): this {
    if (!value) return this;
    const storage = instance.storage?.partitions as Record<string, TypedArray> | undefined;
    if (!storage) return this;
    let changed = false;
    for (const key in value) {
      const propertyValue = value[key];
      if (propertyValue !== undefined && key in storage) {
        changed ||= storage[key]![entity] !== propertyValue;
        storage[key]![entity] = propertyValue;
      }
    }
    if (changed && this.#ownersById[instance.id]?.[entity] === 1) {
      this.#markChanged(instance.id, entity);
    }
    return this;
  }
}
