import { BooleanArray } from "@phughesmcr/booleanarray";
import { getPartitionByteSize, PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import { createEntityArray, type EntityArray } from "@/entity/entity.ts";
import { ReusableEntityIterator } from "@/entity/entity.ts";
import { componentDisplayName, formatComponentNotRegistered, NotRegisteredError } from "@/errors.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import type { Entity } from "@/entity/entity.ts";
import type { ComponentData, SchemaOrNull, TypedArray } from "@/types/partitions.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
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

type ComponentState = {
  readonly instance: DynamicComponentInstance;
  changed?: BooleanArray;
  changedCount: number;
  changedList?: EntityArray;
  changedIterator?: ReusableEntityIterator;
  changedPositions?: EntityArray;
  readonly isUncappedTag: boolean;
  readonly maxEntities: number;
  ownerCount: number;
  ownerList?: EntityArray;
  ownerIterator?: ReusableEntityIterator;
  ownerPositions?: EntityArray;
  owners?: Uint8Array;
  readonly usesSparseStorage: boolean;
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
  /** Shared empty changed iterator returned for tag components */
  #emptyChangedIterator: ReusableEntityIterator;
  /** Shared empty owner iterator returned for components with no owners */
  #emptyOwnerIterator: ReusableEntityIterator;
  /** The registry of component instances */
  #registry: Map<DynamicComponent, DynamicComponentInstance>;
  /** The registry of component instances by name */
  #registryByName: Record<string, DynamicComponentInstance>;
  /** Frozen public registry view keyed by component name */
  #publicRegistry: Readonly<Record<string, DynamicComponentInstance>>;
  /** Component instances indexed by component definition id */
  #registryByComponentId: DynamicComponentInstance[];
  /** Component ownership and changed state indexed by component instance id */
  #states: ComponentState[];

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
    this.#emptyChangedIterator = new ReusableEntityIterator(createEntityArray(0));
    this.#emptyOwnerIterator = new ReusableEntityIterator(createEntityArray(0));
    this.#registry = new Map();
    this.#registryByName = {};
    this.#publicRegistry = {};
    this.#registryByComponentId = [];
    this.#states = [];
    // register each component
    for (const component of components) {
      const maxEntities = component.maxEntities;
      // instance storage
      const storage = this.#buffer.addPartition(component[$_PARTITION_KEY]);
      const instanceId = this.#registry.size;
      const proxy = storage ?
        new StorageProxy({
          storage,
          markChanged: (entity: Entity) => {
            const state = this.#states[instanceId];
            if (state !== undefined) this.#markChanged(state, entity);
          },
          capacity,
        }) :
        null;
      // register component instance
      const instance = new ComponentInstance({
        id: instanceId,
        has: (entity: Entity): boolean => this.#states[instanceId]?.owners?.[entity] === 1,
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
      this.#states[instance.id] = {
        changedCount: 0,
        instance,
        isUncappedTag: storage === null && maxEntities === null,
        maxEntities: maxEntities ?? 0,
        ownerCount: 0,
        usesSparseStorage,
      };
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
  #getListCapacity(state: ComponentState): number {
    const maxEntities = state.maxEntities;
    return Math.min(maxEntities === 0 ? this.#capacity : maxEntities, this.#capacity);
  }

  /** Allocate ownership tracking for a component only when it first gains an owner. */
  #ensureOwnershipState(state: ComponentState): Uint8Array {
    let owners = state.owners;
    if (owners !== undefined) return owners;

    const ownerList = createEntityArray(this.#capacity, this.#getListCapacity(state));
    owners = new Uint8Array(this.#capacity);
    state.owners = owners;
    state.ownerList = ownerList;
    state.ownerPositions = createEntityArray(this.#capacity);
    state.ownerIterator = new ReusableEntityIterator(ownerList);
    return owners;
  }

  /** Append an entity to a component's dense owner list. */
  #appendOwner(state: ComponentState, entity: Entity): void {
    const ownerCount = state.ownerCount;
    const ownerList = state.ownerList!;
    const ownerPositions = state.ownerPositions!;
    ownerList[ownerCount] = entity;
    ownerPositions[entity] = ownerCount;
    state.ownerCount = ownerCount + 1;
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
  #acquireOwnership(state: ComponentState, entity: Entity, owners: Uint8Array): boolean {
    const alreadyOwned = owners[entity] === 1;
    if (alreadyOwned) return false;
    owners[entity] = 1;
    this.#appendOwner(state, entity);
    return true;
  }

  /** Allocate changed tracking for data components only when a write marks them changed. */
  #ensureChangedState(state: ComponentState): BooleanArray | undefined {
    let changed = state.changed;
    if (changed !== undefined) return changed;

    const instance = state.instance;
    if (instance === undefined || instance.storage === null) return undefined;

    const changedList = createEntityArray(this.#capacity, this.#getListCapacity(state));
    changed = new BooleanArray(this.#capacity);
    state.changed = changed;
    state.changedList = changedList;
    state.changedPositions = createEntityArray(this.#capacity);
    state.changedIterator = new ReusableEntityIterator(changedList);
    return changed;
  }

  /** Mark a data component changed once per entity per refresh window. */
  #markChanged(state: ComponentState, entity: Entity): void {
    const changed = this.#ensureChangedState(state);
    if (changed === undefined || changed.get(entity)) return;

    const changedList = state.changedList;
    const changedPositions = state.changedPositions;
    if (changedList === undefined || changedPositions === undefined) {
      throw new Error(`Failed to find dense changed state for component id ${state.instance.id}.`);
    }

    const changedCount = state.changedCount;
    changed.set(entity, true);
    changedList[changedCount] = entity;
    changedPositions[entity] = changedCount;
    state.changedCount = changedCount + 1;
  }

  /** Mark a data component changed by instance id if the entity owns it. */
  #markInstanceIdChanged(instanceId: number, entity: Entity): boolean {
    const state = this.#states[instanceId];
    if (state === undefined) return false;
    const instance = state.instance;
    if (instance === undefined || instance.storage === null) return false;
    if (state.owners?.[entity] !== 1) return false;
    this.#markChanged(state, entity);
    return true;
  }

  /** Remove a data component from changed iteration if present. */
  #unmarkChanged(state: ComponentState, entity: Entity): void {
    const changed = state.changed;
    if (changed === undefined || !changed.get(entity)) return;

    const changedList = state.changedList;
    const changedPositions = state.changedPositions;
    if (changedList === undefined || changedPositions === undefined) {
      throw new Error(`Failed to find dense changed state for component id ${state.instance.id}.`);
    }

    const changedCount = state.changedCount;
    state.changedCount = this.#removeFromDenseList(
      changedList,
      changedPositions,
      changedCount,
      entity,
    );
    changed.set(entity, false);
  }

  /** Reset one entity's component storage slot to its default empty value. */
  #clearEntityStorage(storage: Record<string, unknown>, entity: Entity): void {
    for (const key in storage) {
      const partition = storage[key];
      if (ArrayBuffer.isView(partition as ArrayBufferView)) {
        (partition as TypedArray)[entity] = 0;
      } else if (partition !== undefined && partition !== null) {
        Reflect.deleteProperty(partition, String(entity));
      }
    }
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
    const state = this.#states[id];
    if (state === undefined) return false;
    const owners = this.#ensureOwnershipState(state);

    const storage = instance.storage;
    if (state.isUncappedTag) {
      return this.#acquireOwnership(state, entity, owners);
    }

    const alreadyOwned = owners[entity] === 1;
    const maxEntities = state.maxEntities;
    if (!alreadyOwned && maxEntities !== 0) {
      const ownerCount = state.ownerCount;
      if (ownerCount >= maxEntities) {
        throw new RangeError(
          `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
        );
      }
    }

    const ownershipChanged = this.#acquireOwnership(state, entity, owners);
    if (ownershipChanged && storage !== null) {
      this.#clearEntityStorage(storage.partitions as Record<string, unknown>, entity);
    }

    const hasData = isObject(data);
    if (storage !== null && hasData) {
      this.#markChanged(state, entity);
    }

    // Set data if provided
    if (hasData && storage !== null) {
      const partitions = storage.partitions as Record<string, TypedArray>;
      for (const key in data) {
        if (!hasOwnProperty(data, key)) continue;
        const value = data[key];
        if (value !== undefined && hasOwnProperty(partitions, key)) {
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
    return instance ? this.#states[instance.id]?.owners?.[entity] === 1 : false;
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
    return this.#states[instance.id]?.owners?.[entity] === 1;
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
  getInstance(component: string): DynamicComponentInstance | undefined;
  getInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage>): ComponentInstance<TValue, TStorage> | undefined;
  getInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string):
    | ComponentInstance<TValue, TStorage>
    | DynamicComponentInstance
    | undefined;
  getInstance(component: DynamicComponent | string): DynamicComponentInstance | undefined {
    if (typeof component === "string") {
      return this.#registryByName[component];
    }
    return this.#registryByComponentId[component[$_COMPONENT_ID_KEY]];
  }

  /**
   * Get a registered component instance
   * @param component - The component to get the instance of
   * @returns The component instance
   * @throws {NotRegisteredError} If the component is not registered
   */
  require(component: string): DynamicComponentInstance;
  require<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage>): ComponentInstance<TValue, TStorage>;
  require<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): ComponentInstance<TValue, TStorage> | DynamicComponentInstance;
  require(component: DynamicComponent | string): DynamicComponentInstance {
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
    const state = this.#states[instance.id];
    if (state === undefined) return;
    const iterator = state.changedIterator;
    if (iterator === undefined) return this.#emptyChangedIterator.reset(0);
    return iterator.reset(state.changedCount);
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
    const state = this.#states[instance.id];
    if (state === undefined) return;
    return (state.ownerIterator ?? this.#emptyOwnerIterator).reset(state.ownerCount);
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
      const state = this.#states[instance.id];
      const maxEntities = state?.maxEntities ?? 0;
      if (state === undefined || maxEntities === 0 || state.owners?.[entity] === 1) continue;
      if (state.ownerCount >= maxEntities) {
        throw new RangeError(
          `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
        );
      }
    }
  }

  /** Preflight max-owner capacity for adding one component to a dense entity list. */
  preflightAddInstanceToEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(instance: ComponentInstance<TValue, TStorage>, entities: EntityArray, count: number): void {
    const state = this.#states[instance.id];
    const maxEntities = state?.maxEntities ?? 0;
    if (state === undefined || maxEntities === 0) return;

    let newOwners = 0;
    for (let i = 0; i < count; i++) {
      if (state.owners?.[entities[i]!] !== 1) newOwners++;
    }
    if (state.ownerCount + newOwners > maxEntities) {
      throw new RangeError(
        `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
      );
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
    for (let i = 0; i < this.#states.length; i++) {
      const state = this.#states[i]!;
      if (state.owners?.[entity] === 1) {
        components.push(state.instance);
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
    for (let i = 0; i < this.#states.length; i++) {
      const state = this.#states[i]!;
      const changed = state.changed;
      const changedList = state.changedList;
      const changedPositions = state.changedPositions;
      const changedCount = state.changedCount;
      if (changed !== undefined && changedList !== undefined && changedPositions !== undefined) {
        for (let j = 0; j < changedCount; j++) {
          const entity = changedList[j]!;
          changed.set(entity, false);
          changedList[j] = 0;
          changedPositions[entity] = 0;
        }
      }
      state.changedCount = 0;
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
    const state = this.#states[id];
    if (state === undefined) return false;
    const owners = state.owners;
    const wasOwned = owners?.[entity] === 1;
    if (!wasOwned) return false;

    const ownerList = state.ownerList!;
    const ownerPositions = state.ownerPositions!;
    const ownerCount = state.ownerCount;
    state.ownerCount = this.#removeFromDenseList(ownerList, ownerPositions, ownerCount, entity);

    if (owners !== undefined && entity < owners.length) {
      owners[entity] = 0;
    }
    const storage = instance.storage;
    if (storage !== null) {
      this.#unmarkChanged(state, entity);
    }
    if (wasOwned && storage !== null && state.usesSparseStorage) {
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
      if (!hasOwnProperty(value, key)) continue;
      const propertyValue = value[key];
      if (propertyValue !== undefined && hasOwnProperty(storage, key)) {
        changed ||= storage[key]![entity] !== propertyValue;
        storage[key]![entity] = propertyValue;
      }
    }
    const state = this.#states[instance.id];
    if (changed && state?.owners?.[entity] === 1) {
      this.#markChanged(state, entity);
    }
    return this;
  }
}
