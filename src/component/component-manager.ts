import { getPartitionByteSize, Partition, PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import { createEntityArray, createSlotArray, type EntityArray, packEntity, type PackSlot } from "@/entity/entity.ts";
import { ReusableEntityIterator, ReusableSlotPackIterator } from "@/entity/entity.ts";
import {
  ComponentDataError,
  componentDisplayName,
  formatComponentNotRegistered,
  NotRegisteredError,
} from "@/errors.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import { type Entity, entityIndex } from "@/entity/entity.ts";
import type { ComponentData, SchemaOrNull, SchemaProperty, TypedArray } from "@/types/partitions.ts";
import { ComponentInstance } from "./component-instance.ts";
import type { Component } from "./component.ts";
import {
  captureComponentManagerSnapshot,
  type ComponentManagerSnapshot,
  type ComponentSnapshotRestoreHooks,
  restoreComponentManagerSnapshot,
} from "./component-snapshot.ts";
import { prepareEntityStorageData, writeEntityStorageData, writeEntityStorageRow } from "./component-storage-write.ts";
import { StorageProxy } from "./storage-proxy.ts";

export type { ComponentManagerSnapshot };

/** Initial length of a component's owner/changed lists; they double on demand up to the list capacity. */
const INITIAL_LIST_LENGTH = 16;

function roundUpToMultiple(value: number, multiple: number): number {
  const remainder = value % multiple;
  return remainder === 0 ? value : value + multiple - remainder;
}

/**
 * Dense rows needed for a capped component's sparse storage, or `null` for dense (capacity-sized) storage.
 * A cap that can never bind (at or above world capacity) is stored densely, so it never over-allocates
 * and cannot be starved by stray raw writes.
 */
function getSparseRowCount(component: DynamicComponent, capacity: number): number | null {
  const maxEntities = component.maxEntities;
  return maxEntities === null || maxEntities >= capacity ? null : maxEntities;
}

function getComponentStorageSize(component: DynamicComponent, capacity: number): number {
  const schema = component[$_PARTITION_KEY].schema;
  if (schema === null) return 0;
  return getPartitionByteSize(schema, getSparseRowCount(component, capacity) ?? capacity);
}

/** The component's own partition, or a world-sized copy when its owner cap exceeds world capacity. */
function getWorldPartition(component: DynamicComponent, capacity: number): DynamicComponent[typeof $_PARTITION_KEY] {
  const partition = component[$_PARTITION_KEY];
  const rows = getSparseRowCount(component, capacity);
  if (rows === partition.maxOwners) return partition;
  return new Partition({ name: component.name, schema: partition.schema, maxOwners: rows } as never);
}

/** A preflighted bundle entry ready for component-manager commit. */
export type ComponentBundleCommitEntry = {
  /** The registered component instance to add or update. */
  instance: DynamicComponentInstance;
  /** Optional numeric data to merge into component storage. */
  data: Partial<Record<string, number>> | undefined;
};

/** Sparse (capped) storage column; every column of one component shares a single slot -> row index. */
type SparseColumn = TypedArray & {
  getEntity(entity: number): number | undefined;
  setEntity(entity: number, value: number): void;
  deleteEntity(entity: number): boolean;
};

type ComponentState = {
  readonly instance: DynamicComponentInstance;
  changedCount: number;
  changedList?: EntityArray;
  changedIterator?: ReusableSlotPackIterator;
  changedPositions?: EntityArray;
  readonly maxEntities: number;
  ownerCount: number;
  ownerList?: EntityArray;
  ownerIterator?: ReusableSlotPackIterator;
  ownerPositions?: EntityArray;
  owners?: Uint8Array;
  readonly usesSparseStorage: boolean;
  /** Dense and sparse partition keys in stable registration order. */
  readonly storageKeys: readonly string[];
  /** Parallel storage columns for `storageKeys`. */
  readonly storageColumns: readonly TypedArray[];
  /** Monotonic revision for membership and value changes. */
  revision: number;
  /** World revision token assigned on the last change. */
  lastChangedRevision: number;
  /** One-element typed-array scratch buffers for value canonicalization. */
  readonly coercionScratch: Record<string, TypedArray>;
  /** Parallel scratch columns for `storageKeys` (avoids string-key lookup on write). */
  readonly coercionScratchColumns: readonly TypedArray[];
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
  /** Canonical entity liveness check supplied by the owning world. */
  #isActive: (entity: Entity) => boolean;
  /** Pack slot -> entity at owner/changed iterator edges */
  #packSlot: PackSlot;
  /** Tracking callbacks used by rollback restore (allocated once). */
  readonly #snapshotHooks: ComponentSnapshotRestoreHooks<ComponentState> = {
    ensureOwnershipState: (state, minOwners) => this.#ensureOwnershipState(state, minOwners),
    ensureChangedState: (state, minChanged) => this.#ensureChangedState(state, minChanged),
    reserveSparseSlot: (state, owners, slot) => this.#reserveSparseSlot(state, owners, slot),
    bumpRevision: (state) => this.#bumpRevision(state),
  };

  /**
   * Create a new component manager.
   * @param capacity - The capacity of the component manager
   * @param components - The components to register
   * @param nextWorldRevision - Optional monotonic world revision bump
   * @param packSlot - Packs a live slot into an entity handle (defaults to generation 0)
   * @param isActive - Validates canonical live entity handles
   */
  constructor(
    capacity: number,
    components: DynamicComponent[],
    nextWorldRevision: () => number = () => 0,
    packSlot: PackSlot = (slot) => packEntity(slot, 0),
    isActive: (entity: Entity) => boolean = (entity) => Number.isInteger(entity) && entity >= 0 && entity < capacity,
  ) {
    // create the storage buffer
    const storageSize = components.reduce((acc, component) => acc + getComponentStorageSize(component, capacity), 0);
    const size = roundUpToMultiple(Math.max(storageSize, capacity), capacity);
    this.#buffer = new PartitionedBuffer(size, capacity);
    this.#capacity = capacity;
    this.#nextWorldRevision = nextWorldRevision;
    this.#packSlot = packSlot;
    this.#isActive = isActive;
    // create the various registries
    this.#emptyChangedIterator = new ReusableEntityIterator(createEntityArray(0));
    this.#emptyOwnerIterator = new ReusableEntityIterator(createEntityArray(0));
    this.#registryByName = Object.create(null);
    this.#publicRegistry = {};
    this.#registryByComponentId = [];
    this.#states = [];
    // register each component
    for (const component of components) {
      const maxEntities = component.maxEntities;
      // instance storage
      const storage = this.#buffer.addPartition(getWorldPartition(component, capacity));
      const instanceId = this.#states.length;
      const coercionScratch: Record<string, TypedArray> = Object.create(null);
      const storageKeys: string[] = [];
      const storageColumns: TypedArray[] = [];
      const coercionScratchColumns: TypedArray[] = [];
      let usesSparseStorage = false;
      if (storage !== null) {
        const partitions = storage.partitions as Record<string, TypedArray>;
        for (const key of Object.keys(partitions)) {
          const partition = partitions[key]!;
          const property = (component.schema as Record<string, SchemaProperty>)[key]!;
          const Ctor = Array.isArray(property) ? property[0] : property;
          const scratchColumn = new Ctor(1);
          coercionScratch[key] = scratchColumn;
          storageKeys.push(key);
          storageColumns.push(partition);
          coercionScratchColumns.push(scratchColumn);
          if (!ArrayBuffer.isView(partition)) usesSparseStorage = true;
        }
      }
      const proxy = storage ?
        new StorageProxy({
          storage,
          markChanged: (slot: number) => {
            // Only owners are tracked: raw writes to non-owner slots are an unguarded escape hatch.
            const state = this.#states[instanceId];
            if (state !== undefined && state.owners?.[slot] === 1) this.#markChanged(state, slot);
          },
          has: (entity: Entity) => this.#entityOwnsInstanceId(instanceId, entity),
          packSlot,
          capacity,
          componentName: component.name,
          coercionScratch,
        }) :
        null;
      // register component instance
      const instance = new ComponentInstance({
        id: instanceId,
        has: (entity: Entity): boolean => this.#entityOwnsInstanceId(instanceId, entity),
        markChanged: (entity: Entity): boolean => this.#markInstanceIdChanged(instanceId, entity),
        proxy,
        storage,
        type: component,
        getRevision: () => this.#states[instanceId]?.revision ?? 0,
      });
      this.#states[instance.id] = {
        changedCount: 0,
        instance,
        maxEntities: maxEntities ?? 0,
        ownerCount: 0,
        usesSparseStorage,
        storageKeys,
        storageColumns,
        coercionScratchColumns,
        revision: 0,
        lastChangedRevision: 0,
        coercionScratch,
      };
      this.#registryByName[component.name] = instance;
      this.#registryByComponentId[component[$_COMPONENT_ID_KEY]] = instance;
    }
    this.#publicRegistry = Object.freeze({ ...this.#registryByName });
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
    return this.#states.length;
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

  /** Allocate a list for at least `minLength` entries: doubling growth, capped at the component's list capacity. */
  #allocateList(state: ComponentState, current: EntityArray | undefined, minLength: number): EntityArray {
    const length = current === undefined ? INITIAL_LIST_LENGTH : current.length * 2;
    const list = createSlotArray(
      this.#capacity,
      Math.min(Math.max(length, minLength), this.#getListCapacity(state)),
    );
    if (current !== undefined) list.set(current);
    return list;
  }

  /**
   * Allocate ownership tracking for a component only when it first gains an owner, and make room for `minOwners`.
   * The owner list grows on demand; `owners` and `ownerPositions` are capacity-sized slot indexes.
   */
  #ensureOwnershipState(state: ComponentState, minOwners: number = 0): Uint8Array {
    let owners = state.owners;
    if (owners === undefined) {
      owners = new Uint8Array(this.#capacity);
      state.owners = owners;
      state.ownerPositions = createSlotArray(this.#capacity);
    }
    const ownerList = state.ownerList;
    if (ownerList === undefined || ownerList.length < minOwners) {
      const grown = this.#allocateList(state, ownerList, minOwners);
      state.ownerList = grown;
      if (state.ownerIterator === undefined) state.ownerIterator = new ReusableSlotPackIterator(grown, this.#packSlot);
      else state.ownerIterator.slots = grown;
    }
    return owners;
  }

  /** Append a storage slot to a component's dense owner list. */
  #appendOwner(state: ComponentState, slot: number): void {
    const ownerCount = state.ownerCount;
    if (ownerCount === state.ownerList!.length) this.#ensureOwnershipState(state, ownerCount + 1);
    state.ownerList![ownerCount] = slot;
    state.ownerPositions![slot] = ownerCount;
    state.ownerCount = ownerCount + 1;
  }

  /** Remove a slot from a dense list whose membership was already checked. Stale tail entries are never read. */
  #removeFromDenseList(list: EntityArray, positions: EntityArray, count: number, slot: number): number {
    const removeIndex = positions[slot]!;
    const lastIndex = count - 1;
    if (removeIndex !== lastIndex) {
      const lastSlot = list[lastIndex]!;
      list[removeIndex] = lastSlot;
      positions[lastSlot] = removeIndex;
    }
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

  /**
   * Allocate changed tracking for data components only when a write marks them changed, and make room for
   * `minChanged` entries. Membership is a sparse-set check against `changedPositions`/`changedList`.
   * @returns the changed positions, or `undefined` for tag components
   */
  #ensureChangedState(state: ComponentState, minChanged: number = 0): EntityArray | undefined {
    if (state.instance.storage === null) return undefined;
    let positions = state.changedPositions;
    if (positions === undefined) {
      positions = createSlotArray(this.#capacity);
      state.changedPositions = positions;
    }
    const changedList = state.changedList;
    if (changedList === undefined || changedList.length < minChanged) {
      const grown = this.#allocateList(state, changedList, minChanged);
      state.changedList = grown;
      if (state.changedIterator === undefined) {
        state.changedIterator = new ReusableSlotPackIterator(grown, this.#packSlot);
      } else {
        state.changedIterator.slots = grown;
      }
    }
    return positions;
  }

  /** Whether `slot` is in a component's current changed window. */
  #isChanged(state: ComponentState, slot: number): boolean {
    const positions = state.changedPositions;
    if (positions === undefined) return false;
    const position = positions[slot]!;
    return position < state.changedCount && state.changedList![position] === slot;
  }

  /** Mark a data component changed once per entity per refresh window. */
  #markChanged(state: ComponentState, slot: number): void {
    this.#bumpRevision(state);
    if (this.#isChanged(state, slot)) return;
    const changedCount = state.changedCount;
    const positions = this.#ensureChangedState(state, changedCount + 1);
    if (positions === undefined) return;
    state.changedList![changedCount] = slot;
    positions[slot] = changedCount;
    state.changedCount = changedCount + 1;
  }

  /** Mark a data component changed by instance id if the entity owns it. */
  #markInstanceIdChanged(instanceId: number, entity: Entity): boolean {
    const state = this.#states[instanceId];
    if (state === undefined) return false;
    const instance = state.instance;
    if (instance === undefined || instance.storage === null) return false;
    const slot = entityIndex(entity);
    if (!this.#entityOwnsInstanceId(instanceId, entity)) return false;
    this.#markChanged(state, slot);
    return true;
  }

  /** Remove a data component from changed iteration if present. */
  #unmarkChanged(state: ComponentState, slot: number): void {
    if (!this.#isChanged(state, slot)) return;
    state.changedCount = this.#removeFromDenseList(
      state.changedList!,
      state.changedPositions!,
      state.changedCount,
      slot,
    );
  }

  /**
   * Map a capped component's dense row for `slot` before ownership changes, so a storage failure can never leave a
   * half-committed add. Raw writes to non-owner slots (direct partitions, proxy cursor, `setAt`) map rows too and
   * are never released by removal; when the dense rows run out they are reclaimed here, after which at most
   * `ownerCount` rows are mapped and `ownerCount < maxEntities` guarantees room.
   */
  #reserveSparseSlot(state: ComponentState, owners: Uint8Array, slot: number): void {
    const column = state.storageColumns[0] as SparseColumn;
    if (column.getEntity(slot) !== undefined) return;
    try {
      column.setEntity(slot, 0);
      return;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    const getEntity = column.getEntity;
    for (let other = 0; other < this.#capacity; other++) {
      if (owners[other] !== 1 && other !== slot && getEntity(other) !== undefined) column.deleteEntity(other);
    }
    column.setEntity(slot, 0);
  }

  /** Reset one entity's component storage slot to its default empty value. */
  #clearEntityStorage(state: ComponentState, slot: number): void {
    const columns = state.storageColumns;
    for (let i = 0; i < columns.length; i++) columns[i]![slot] = 0;
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
   * @param dataValidated - When true, the caller already staged canonical values with validateInstanceData
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
    if (data !== undefined && !dataValidated) this.validateInstanceData(instance, data);
    const owners = this.#ensureOwnershipState(state);
    const storage = instance.storage;
    const alreadyOwned = owners[slot] === 1;
    const maxEntities = state.maxEntities;
    if (!alreadyOwned && maxEntities !== 0 && state.ownerCount >= maxEntities) {
      throw new RangeError(`Component "${instance.type.name}" can only be added to ${maxEntities} entities.`);
    }
    if (!alreadyOwned && state.usesSparseStorage) this.#reserveSparseSlot(state, owners, slot);
    const ownershipChanged = this.#acquireOwnership(state, owners, slot);
    if (ownershipChanged) this.#bumpRevision(state);
    if (storage !== null) {
      if (data !== undefined) {
        const changed = writeEntityStorageData(state, data as Record<string, number>, slot, ownershipChanged);
        // A payload always marks a new owner changed, whatever the previous (zero, stale, or unmapped) cell held.
        if (changed || ownershipChanged) this.#markChanged(state, slot);
      } else if (ownershipChanged) {
        // A no-payload attach zero-initializes the row and is a change, exactly like an explicit payload.
        this.#clearEntityStorage(state, slot);
        this.#markChanged(state, slot);
      }
    }

    return ownershipChanged;
  }

  /**
   * Add a registered component instance to a newly created entity, filling its row from template defaults.
   *
   * Ownership, capped-row reservation, revision and changed tracking follow {@link addInstanceToEntity}; only the
   * value source differs. Fields that `data` provides take the canonical values staged by
   * {@link validateInstanceData}; every other field takes its `row` default.
   *
   * @param instance - The registered component instance
   * @param slot - The new entity's storage slot (must not own the instance yet)
   * @param row - Canonical defaults parallel to {@link storageKeysOf}, or `null` for tags
   * @param data - Optional validated override payload
   * @returns `true` if the component ownership changed
   * @internal
   */
  addInstanceWithRow(
    instance: DynamicComponentInstance,
    slot: number,
    row: ArrayLike<unknown> | null,
    data: Record<string, unknown> | undefined,
  ): boolean {
    const state = this.#states[instance.id];
    if (state === undefined) return false;
    const owners = this.#ensureOwnershipState(state);
    if (owners[slot] === 1) return false;
    const maxEntities = state.maxEntities;
    if (maxEntities !== 0 && state.ownerCount >= maxEntities) {
      throw new RangeError(`Component "${instance.type.name}" can only be added to ${maxEntities} entities.`);
    }
    if (state.usesSparseStorage) this.#reserveSparseSlot(state, owners, slot);
    this.#acquireOwnership(state, owners, slot);
    this.#bumpRevision(state);
    if (instance.storage !== null && row !== null) {
      writeEntityStorageRow(state, row, data, slot);
      this.#markChanged(state, slot);
    }
    return true;
  }

  /**
   * Storage field keys of a registered data component, in column order (empty for tags).
   * @internal
   */
  storageKeysOf(instance: DynamicComponentInstance): readonly string[] {
    return this.#states[instance.id]?.storageKeys ?? [];
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
    return instance ? this.#entityOwnsInstanceId(instance.id, entity) : false;
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
    return this.#entityOwnsInstanceId(instance.id, entity);
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

  /** Validate and stage storage-canonical values before a world mutation. @internal */
  validateInstanceData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    instance: ComponentInstance<TValue, TStorage>,
    data: unknown,
  ): void {
    if (data === undefined) return;
    if (instance.storage === null) {
      throw new ComponentDataError(`Component ${instance.type.name} has no data storage.`);
    }
    prepareEntityStorageData(this.#states[instance.id]!, instance.type.name, data);
  }

  #entityOwnsInstanceId(instanceId: number, entity: Entity): boolean {
    return this.#isActive(entity) && this.#states[instanceId]?.owners?.[entityIndex(entity)] === 1;
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
   * Count the owners of a registered component without touching its shared owner iterator,
   * so callers may count during an in-progress {@link getOwners} iteration.
   * @param component The component to count owners for
   * @returns The owner count, or `0` if the component is not registered
   * @internal
   */
  getOwnerCount<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): number {
    const instance = this.getInstance(component);
    if (!instance) return 0;
    return this.#states[instance.id]?.ownerCount ?? 0;
  }

  /**
   * Preflight capacity for adding a set of registered component instances to one entity.
   * @param entries - Unique registered component instances and optional data
   * @param entity - The target entity, or undefined to preflight a fresh owner before entity creation
   * @throws {RangeError} If the entity is out of component capacity or any max owner count would overflow
   * @internal
   */
  preflightAddBundleToEntity(
    entries: readonly ComponentBundleCommitEntry[],
    entity: Entity | undefined,
    count: number = entries.length,
  ): void {
    if (entity !== undefined && entityIndex(entity) >= this.#capacity) {
      throw new RangeError(`Entity ${entity} is outside component capacity.`);
    }
    for (let i = 0; i < count; i++) {
      const instance = entries[i]!.instance;
      const state = this.#states[instance.id];
      const maxEntities = state?.maxEntities ?? 0;
      if (
        state === undefined || maxEntities === 0 ||
        (entity !== undefined && state.owners?.[entityIndex(entity)] === 1)
      ) continue;
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
   * @param count - Active prefix length of `entries`
   * @param addedOut - Scratch array for ownership-changed instances (index-written, never shrunk)
   * @returns Number of ownership-changed instances written to `addedOut`
   * @internal
   */
  addBundleToEntity(
    entries: readonly ComponentBundleCommitEntry[],
    entity: Entity,
    count: number,
    addedOut: DynamicComponentInstance[],
  ): number {
    let addedCount = 0;
    for (let i = 0; i < count; i++) {
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
        addedOut[addedCount++] = instance;
      }
    }
    return addedCount;
  }

  /**
   * Get all components for an entity directly from ownership tracking
   * This is used internally to avoid circular dependencies with the archetype system
   * @param entity The entity to get components for
   * @returns An array of component instances
   */
  getEntityComponents(entity: Entity): DynamicComponentInstance[] {
    const components: DynamicComponentInstance[] = [];
    if (!this.#isActive(entity)) return components;
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
    const state = this.#states[instance.id];
    if (instance.storage === null || state === undefined) return undefined;
    const keys = state.storageKeys;
    const columns = state.storageColumns;
    const slot = entityIndex(entity);
    const result: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) result[keys[i]!] = columns[i]![slot] ?? Number.NaN;
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
    const state = this.#states[instance.id];
    if (instance.storage === null || state === undefined) return false;
    if (!this.entityOwnsInstance(instance, entity)) return false;
    const target = out as Record<string, number>;
    const keys = state.storageKeys;
    const columns = state.storageColumns;
    const slot = entityIndex(entity);
    for (let i = 0; i < keys.length; i++) target[keys[i]!] = columns[i]![slot] ?? Number.NaN;
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
    // The changed window is a sparse set: resetting the count empties it without touching the lists.
    for (let i = 0; i < this.#states.length; i++) this.#states[i]!.changedCount = 0;
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

    state.ownerCount = this.#removeFromDenseList(state.ownerList!, state.ownerPositions!, state.ownerCount, slot);
    owners[slot] = 0;
    if (instance.storage !== null) this.#unmarkChanged(state, slot);
    this.#bumpRevision(state);
    // Every column of a capped component shares one slot -> row index, so one delete unmaps the whole row.
    if (state.usesSparseStorage) (state.storageColumns[0] as SparseColumn).deleteEntity(slot);
    return true;
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
    if (instance.storage === null) return this;
    this.validateInstanceData(instance, value);
    const state = this.#states[instance.id]!;
    const slot = entityIndex(entity);
    const changed = writeEntityStorageData(state, value as Record<string, number>, slot, false);
    if (changed && state.owners?.[slot] === 1) this.#markChanged(state, slot);
    return this;
  }

  /** Capture a full ownership + column snapshot for rollback. */
  captureSnapshot(): ComponentManagerSnapshot {
    return captureComponentManagerSnapshot(this.#states);
  }

  /** Restore a full ownership + column snapshot for rollback. */
  restoreSnapshot(snapshot: ComponentManagerSnapshot): void {
    restoreComponentManagerSnapshot(this.#states, snapshot, this.#snapshotHooks);
  }
}
