import { BooleanArray } from "@phughesmcr/booleanarray";
import { getPartitionByteSize, PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import { createEntityArray, createSlotArray, type EntityArray, packEntity, type PackSlot } from "@/entity/entity.ts";
import { ReusableEntityIterator, ReusableSlotPackIterator } from "@/entity/entity.ts";
import { componentDisplayName, formatComponentNotRegistered, NotRegisteredError } from "@/errors.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import { type Entity, entityIndex } from "@/entity/entity.ts";
import type { ComponentData, SchemaOrNull, TypedArray } from "@/types/partitions.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
import { ComponentInstance } from "./component-instance.ts";
import { StorageProxy } from "./storage-proxy.ts";
import type { Component } from "./component.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";

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
  changedIterator?: ReusableSlotPackIterator;
  changedPositions?: EntityArray;
  readonly isUncappedTag: boolean;
  readonly maxEntities: number;
  ownerCount: number;
  ownerList?: EntityArray;
  ownerIterator?: ReusableSlotPackIterator;
  ownerPositions?: EntityArray;
  owners?: Uint8Array;
  readonly usesSparseStorage: boolean;
  /** Dense typed-array partition keys in stable registration order. */
  readonly storageKeys: readonly string[];
  /** Parallel typed-array columns for `storageKeys`. */
  readonly storageColumns: readonly TypedArray[];
  /** Monotonic revision for membership and value changes. */
  revision: number;
  /** World revision token assigned on the last change. */
  lastChangedRevision: number;
  /** One-element typed-array scratch buffers for value canonicalization. */
  coercionScratch?: Record<string, TypedArray>;
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
  /** World revision bump callback */
  #nextWorldRevision: () => number;
  /** Optional column-write hook for rollback capture */
  #beforeColumnWrite?: (instanceId: number, key: string, slot: number) => void;
  /** Pack slot → entity at owner/changed iterator edges */
  #packSlot: PackSlot;

  /**
   * Create a new component manager.
   * @param capacity - The capacity of the component manager
   * @param components - The components to register
   * @param nextWorldRevision - Optional monotonic world revision bump
   * @param packSlot - Packs a live slot into an entity handle (defaults to generation 0)
   */
  constructor(
    capacity: number,
    components: DynamicComponent[],
    nextWorldRevision: () => number = () => 0,
    packSlot: PackSlot = (slot) => packEntity(slot, 0),
  ) {
    // create the storage buffer
    const storageSize = components.reduce((acc, component) => acc + getComponentStorageSize(component, capacity), 0);
    const size = roundUpToMultiple(Math.max(storageSize, capacity), capacity);
    this.#buffer = new PartitionedBuffer(size, capacity);
    this.#capacity = capacity;
    this.#nextWorldRevision = nextWorldRevision;
    this.#packSlot = packSlot;
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
      const coercionScratch: Record<string, TypedArray> = {};
      const storageKeys: string[] = [];
      const storageColumns: TypedArray[] = [];
      let usesSparseStorage = false;
      if (storage !== null) {
        const partitions = storage.partitions as Record<string, TypedArray>;
        for (const key in partitions) {
          const partition = partitions[key];
          if (ArrayBuffer.isView(partition)) {
            const Ctor = partition.constructor as new (length: number) => TypedArray;
            coercionScratch[key] = new Ctor(1);
            storageKeys.push(key);
            storageColumns.push(partition);
          } else if (partition !== undefined && partition !== null) {
            usesSparseStorage = true;
          }
        }
      }
      const proxy = storage ?
        new StorageProxy({
          storage,
          markChanged: (entity: Entity) => {
            const state = this.#states[instanceId];
            if (state !== undefined) this.#markChanged(state, entity, entityIndex(entity));
          },
          capacity,
          componentName: component.name,
          coercionScratch,
          beforeWrite: (slot, key) => this.#beforeColumnWrite?.(instanceId, key, slot),
        }) :
        null;
      // register component instance
      const instance = new ComponentInstance({
        id: instanceId,
        has: (entity: Entity): boolean => this.#states[instanceId]?.owners?.[entityIndex(entity)] === 1,
        markChanged: (entity: Entity): boolean => this.#markInstanceIdChanged(instanceId, entity),
        proxy,
        storage,
        type: component,
        getRevision: () => this.#states[instanceId]?.revision ?? 0,
      });
      this.#states[instance.id] = {
        changedCount: 0,
        instance,
        isUncappedTag: storage === null && maxEntities === null,
        maxEntities: maxEntities ?? 0,
        ownerCount: 0,
        usesSparseStorage,
        storageKeys,
        storageColumns,
        revision: 0,
        lastChangedRevision: 0,
        coercionScratch,
      };
      this.#registry.set(component, instance);
      this.#registryByName[component.name] = instance;
      this.#registryByComponentId[component[$_COMPONENT_ID_KEY]] = instance;
    }
    this.#publicRegistry = Object.freeze({ ...this.#registryByName });
  }

  /** Wire a rollback column-write capture hook. */
  setBeforeColumnWrite(hook: ((instanceId: number, key: string, slot: number) => void) | undefined): void {
    this.#beforeColumnWrite = hook;
  }

  /** Latest world revision assigned to any of the supplied component instances. */
  latestChangedRevision(components: readonly DynamicComponent[]): number {
    let latest = 0;
    for (const component of components) {
      const instance = this.getInstance(component);
      if (instance === undefined) continue;
      const state = this.#states[instance.id];
      if (state !== undefined) latest = Math.max(latest, state.lastChangedRevision);
    }
    return latest;
  }

  /** Bump a component state's revision tokens. */
  #bumpRevision(state: ComponentState): void {
    state.revision++;
    state.lastChangedRevision = this.#nextWorldRevision();
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

    const ownerList = createSlotArray(this.#capacity, this.#getListCapacity(state));
    owners = new Uint8Array(this.#capacity);
    state.owners = owners;
    state.ownerList = ownerList;
    state.ownerPositions = createSlotArray(this.#capacity);
    state.ownerIterator = new ReusableSlotPackIterator(ownerList, this.#packSlot);
    return owners;
  }

  /** Append a storage slot to a component's dense owner list. */
  #appendOwner(state: ComponentState, slot: number): void {
    const ownerCount = state.ownerCount;
    const ownerList = state.ownerList!;
    const ownerPositions = state.ownerPositions!;
    ownerList[ownerCount] = slot;
    ownerPositions[slot] = ownerCount;
    state.ownerCount = ownerCount + 1;
  }

  /** Remove a slot from a dense list whose membership was already checked. */
  #removeFromDenseList(list: EntityArray, positions: EntityArray, count: number, slot: number): number {
    const removeIndex = positions[slot]!;
    const lastIndex = count - 1;
    const lastSlot = list[lastIndex]!;
    if (removeIndex !== lastIndex) {
      list[removeIndex] = lastSlot;
      positions[lastSlot] = removeIndex;
    }
    list[lastIndex] = 0;
    positions[slot] = 0;
    return lastIndex;
  }

  /**
   * Claim ownership for an entity when it is not already owned.
   * @returns `true` when ownership changed from unowned to owned
   */
  #acquireOwnership(state: ComponentState, owners: Uint8Array, slot: number): boolean {
    const alreadyOwned = owners[slot] === 1;
    if (alreadyOwned) return false;
    owners[slot] = 1;
    this.#appendOwner(state, slot);
    return true;
  }

  /** Allocate changed tracking for data components only when a write marks them changed. */
  #ensureChangedState(state: ComponentState): BooleanArray | undefined {
    let changed = state.changed;
    if (changed !== undefined) return changed;

    const instance = state.instance;
    if (instance === undefined || instance.storage === null) return undefined;

    const changedList = createSlotArray(this.#capacity, this.#getListCapacity(state));
    changed = new BooleanArray(this.#capacity);
    state.changed = changed;
    state.changedList = changedList;
    state.changedPositions = createSlotArray(this.#capacity);
    state.changedIterator = new ReusableSlotPackIterator(changedList, this.#packSlot);
    return changed;
  }

  /** Mark a data component changed once per entity per refresh window. */
  #markChanged(state: ComponentState, _entity: Entity, slot: number): void {
    const changed = this.#ensureChangedState(state);
    if (changed === undefined || changed.get(slot)) return;

    const changedList = state.changedList;
    const changedPositions = state.changedPositions;
    if (changedList === undefined || changedPositions === undefined) {
      throw new Error(`Failed to find dense changed state for component id ${state.instance.id}.`);
    }

    const changedCount = state.changedCount;
    changed.set(slot, true);
    changedList[changedCount] = slot;
    changedPositions[slot] = changedCount;
    state.changedCount = changedCount + 1;
    this.#bumpRevision(state);
  }

  /** Mark a data component changed by instance id if the entity owns it. */
  #markInstanceIdChanged(instanceId: number, entity: Entity): boolean {
    const state = this.#states[instanceId];
    if (state === undefined) return false;
    const instance = state.instance;
    if (instance === undefined || instance.storage === null) return false;
    const slot = entityIndex(entity);
    if (state.owners?.[slot] !== 1) return false;
    this.#markChanged(state, entity, slot);
    return true;
  }

  /** Remove a data component from changed iteration if present. */
  #unmarkChanged(state: ComponentState, slot: number): void {
    const changed = state.changed;
    if (changed === undefined || !changed.get(slot)) return;

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
      slot,
    );
    changed.set(slot, false);
  }

  /** Reset one entity's component storage slot to its default empty value. */
  #clearEntityStorage(storage: Record<string, unknown>, slot: number): void {
    for (const key in storage) {
      const partition = storage[key];
      if (ArrayBuffer.isView(partition as ArrayBufferView)) {
        (partition as TypedArray)[slot] = 0;
      } else if (partition !== undefined && partition !== null) {
        Reflect.deleteProperty(partition, String(slot));
      }
    }
  }

  /**
   * Write schema columns from a data object.
   *
   * When `dataValidated` is true, unknown keys have already been rejected and values are known numbers, so the
   * write path skips `hasOwnProperty` checks. New ownership zeros any schema key absent from `data`.
   */
  #writeEntityStorageData(
    state: ComponentState,
    componentName: string,
    data: Record<string, number | undefined>,
    slot: number,
    ownershipChanged: boolean,
    dataValidated: boolean,
  ): void {
    const keys = state.storageKeys;
    const columns = state.storageColumns;
    const scratch = state.coercionScratch ?? {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const column = columns[i]!;
      const value = dataValidated ? data[key] : (hasOwnProperty(data, key) ? data[key] : undefined);
      if (value === undefined) {
        if (ownershipChanged) column[slot] = 0;
        continue;
      }
      const scratchColumn = scratch[key];
      column[slot] = scratchColumn === undefined ?
        value :
        canonicalizeStoredValue(componentName, key, value, scratchColumn);
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
   * @param slot - Optional precomputed storage slot
   * @param dataValidated - When true, `data` was already schema-validated by the caller
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
    slot: number = entityIndex(entity),
    dataValidated: boolean = false,
  ): boolean {
    const id = instance.id;
    if (slot >= this.#capacity) {
      throw new RangeError(`Entity ${entity} is outside component capacity.`);
    }
    const state = this.#states[id];
    if (state === undefined) return false;
    const owners = this.#ensureOwnershipState(state);

    const storage = instance.storage;
    if (state.isUncappedTag) {
      return this.#acquireOwnership(state, owners, slot);
    }

    const alreadyOwned = owners[slot] === 1;
    const maxEntities = state.maxEntities;
    if (!alreadyOwned && maxEntities !== 0) {
      const ownerCount = state.ownerCount;
      if (ownerCount >= maxEntities) {
        throw new RangeError(
          `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
        );
      }
    }

    const ownershipChanged = this.#acquireOwnership(state, owners, slot);
    if (ownershipChanged) this.#bumpRevision(state);

    const hasData = isObject(data);
    // Clear leftovers only when we cannot apply defaults during the write pass.
    if (ownershipChanged && storage !== null && (!hasData || state.usesSparseStorage)) {
      this.#clearEntityStorage(storage.partitions as Record<string, unknown>, slot);
    }

    if (storage !== null && hasData) {
      this.#markChanged(state, entity, slot);
      if (state.storageKeys.length > 0) {
        this.#writeEntityStorageData(
          state,
          instance.type.name,
          data as Record<string, number | undefined>,
          slot,
          ownershipChanged,
          dataValidated,
        );
      } else {
        // Sparse / object partitions: preserve the prior key-walk write path.
        const partitions = storage.partitions as Record<string, TypedArray>;
        const scratch = state.coercionScratch ?? {};
        for (const key in data) {
          if (!hasOwnProperty(data, key)) continue;
          const value = (data as Record<string, number | undefined>)[key];
          if (value !== undefined && hasOwnProperty(partitions, key)) {
            const scratchColumn = scratch[key];
            partitions[key]![slot] = scratchColumn === undefined ?
              value :
              canonicalizeStoredValue(instance.type.name, key, value, scratchColumn);
          }
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
    return instance ? this.#states[instance.id]?.owners?.[entityIndex(entity)] === 1 : false;
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
    return this.#states[instance.id]?.owners?.[entityIndex(entity)] === 1;
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
    if (entityIndex(entity) >= this.#capacity) {
      throw new RangeError(`Entity ${entity} is outside component capacity.`);
    }
    for (let i = 0; i < entries.length; i++) {
      const instance = entries[i]!.instance;
      const state = this.#states[instance.id];
      const maxEntities = state?.maxEntities ?? 0;
      if (state === undefined || maxEntities === 0 || state.owners?.[entityIndex(entity)] === 1) continue;
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
      if (state.owners?.[entityIndex(entities[i]! as Entity)] !== 1) newOwners++;
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
          entityIndex(entity),
          true,
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
      if (state.owners?.[entityIndex(entity)] === 1) {
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
      result[key] = storage[key]![entityIndex(entity)] ?? Number.NaN;
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
      target[key] = storage[key]![entityIndex(entity)] ?? Number.NaN;
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
          const slot = changedList[j]!;
          changed.set(slot, false);
          changedList[j] = 0;
          changedPositions[slot] = 0;
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
    slot: number = entityIndex(entity),
  ): boolean {
    const id = instance.id;
    const state = this.#states[id];
    if (state === undefined) return false;
    const owners = state.owners;
    const wasOwned = owners?.[slot] === 1;
    if (!wasOwned) return false;

    const ownerList = state.ownerList!;
    const ownerPositions = state.ownerPositions!;
    const ownerCount = state.ownerCount;
    state.ownerCount = this.#removeFromDenseList(ownerList, ownerPositions, ownerCount, slot);

    if (owners !== undefined && slot < owners.length) {
      owners[slot] = 0;
    }
    const storage = instance.storage;
    if (storage !== null) {
      this.#unmarkChanged(state, slot);
    }
    if (wasOwned) this.#bumpRevision(state);
    if (wasOwned && storage !== null && state.usesSparseStorage) {
      const partitions = storage.partitions as Record<string, TypedArray>;
      for (const key in partitions) {
        const partition = partitions[key];
        if (partition && !ArrayBuffer.isView(partition)) {
          Reflect.deleteProperty(partition, String(slot));
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
    const state = this.#states[instance.id];
    const scratch = state?.coercionScratch ?? {};
    const slot = entityIndex(entity);
    let changed = false;
    for (const key in value) {
      if (!hasOwnProperty(value, key)) continue;
      const propertyValue = value[key];
      if (propertyValue !== undefined && hasOwnProperty(storage, key)) {
        const coerced = scratch[key] === undefined ?
          propertyValue :
          canonicalizeStoredValue(instance.type.name, key, propertyValue, scratch[key]!);
        const previous = storage[key]![slot];
        if (!Object.is(previous, coerced)) {
          this.#beforeColumnWrite?.(instance.id, key, slot);
          storage[key]![slot] = coerced;
          changed = true;
        }
      }
    }
    if (changed && state?.owners?.[slot] === 1) {
      this.#bumpRevision(state);
      this.#markChanged(state, entity, slot);
    }
    return this;
  }

  /** Capture a full ownership + column snapshot for rollback. */
  captureSnapshot(): ComponentManagerSnapshot {
    const states: Array<{
      owners?: number[];
      ownerCount: number;
      ownerList?: number[];
      revision: number;
      lastChangedRevision: number;
      columns: Record<string, number[]>;
    }> = [];
    for (let i = 0; i < this.#states.length; i++) {
      const state = this.#states[i]!;
      const instance = state.instance;
      const columns: Record<string, number[]> = {};
      if (instance.storage !== null) {
        const partitions = instance.storage.partitions as Record<string, TypedArray>;
        for (const key in partitions) {
          const partition = partitions[key]!;
          if (ArrayBuffer.isView(partition)) {
            columns[key] = Array.from(partition);
          }
        }
      }
      states.push({
        owners: state.owners === undefined ? undefined : Array.from(state.owners),
        ownerCount: state.ownerCount,
        ownerList: state.ownerList === undefined ? undefined : Array.from(state.ownerList),
        revision: state.revision,
        lastChangedRevision: state.lastChangedRevision,
        columns,
      });
    }
    return { states };
  }

  /** Restore a full ownership + column snapshot for rollback. */
  restoreSnapshot(snapshot: ComponentManagerSnapshot): void {
    for (let i = 0; i < snapshot.states.length; i++) {
      const snap = snapshot.states[i]!;
      const state = this.#states[i]!;
      const instance = state.instance;
      if (snap.owners === undefined) {
        state.owners = undefined;
        state.ownerList = undefined;
        state.ownerPositions = undefined;
        state.ownerIterator = undefined;
        state.ownerCount = 0;
      } else {
        const owners = this.#ensureOwnershipState(state);
        owners.set(snap.owners);
        state.ownerCount = 0;
        if (snap.ownerList !== undefined) {
          for (let j = 0; j < snap.ownerCount; j++) {
            const slot = snap.ownerList[j]!;
            state.ownerList![j] = slot;
            state.ownerPositions![slot] = j;
          }
          state.ownerCount = snap.ownerCount;
        }
      }
      state.revision = snap.revision;
      state.lastChangedRevision = snap.lastChangedRevision;
      state.changed = undefined;
      state.changedList = undefined;
      state.changedPositions = undefined;
      state.changedIterator = undefined;
      state.changedCount = 0;
      if (instance.storage !== null) {
        const partitions = instance.storage.partitions as Record<string, TypedArray>;
        for (const key in snap.columns) {
          const partition = partitions[key];
          const values = snap.columns[key]!;
          if (partition !== undefined && ArrayBuffer.isView(partition)) {
            partition.set(values);
          }
        }
      }
    }
  }
}

/** Full component-manager snapshot used by world rollback. */
export type ComponentManagerSnapshot = {
  readonly states: ReadonlyArray<{
    owners?: number[];
    ownerCount: number;
    ownerList?: number[];
    revision: number;
    lastChangedRevision: number;
    columns: Record<string, number[]>;
  }>;
};
