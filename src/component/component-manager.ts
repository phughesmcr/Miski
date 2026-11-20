import { PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

import { $_COMPONENT_ID_KEY } from "@/constants.ts";
import { type EntityArray, packEntity, type PackSlot } from "@/entity/entity.ts";
import {
  ComponentDataError,
  componentDisplayName,
  EntityNotFoundError,
  formatComponentNotRegistered,
  maxOwnersError,
  NotRegisteredError,
} from "@/errors.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import { type Entity, entityIndex } from "@/entity/entity.ts";
import { hasOwnProperty } from "@/utils.ts";
import type { ComponentData, SchemaOrNull } from "@/types/partitions.ts";
import type { ComponentInstance } from "./component-instance.ts";
import type { Component } from "./component.ts";
import {
  captureComponentManagerSnapshot,
  type ComponentManagerSnapshot,
  type ComponentSnapshotRestoreHooks,
  restoreComponentManagerSnapshot,
} from "./component-snapshot.ts";
import {
  type ComponentState,
  createComponentState,
  getComponentStorageSize,
  type SparseColumn,
} from "./component-state.ts";
import { prepareEntityStorageData, writeEntityStorageData, writeEntityStorageRow } from "./component-storage-write.ts";
import { decodeFieldValue, encodeFieldValue, sideDefault } from "./field-codec.ts";

export type { ComponentManagerSnapshot };

/** A template row compiled for one world by {@link ComponentManager.compileTemplateRow}. @internal */
export type ComponentTemplateRow = {
  /** Raw typed-column values parallel to the component's storage keys. */
  readonly typed: readonly number[];
  /** Side-column values parallel to the side keys; `undefined` takes the per-owner default. */
  readonly side: readonly unknown[];
};

function roundUpToMultiple(value: number, multiple: number): number {
  const remainder = value % multiple;
  return remainder === 0 ? value : value + multiple - remainder;
}

/** A preflighted bundle entry ready for component-manager commit. */
export type ComponentBundleCommitEntry = {
  /** The registered component instance to add or update. */
  instance: DynamicComponentInstance;
  /** Optional data to merge into component storage. */
  data: Partial<Record<string, unknown>> | undefined;
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
  /** The registry of component instances by name */
  #registryByName: Record<string, DynamicComponentInstance>;
  /** Frozen public registry view keyed by component name */
  #publicRegistry: Readonly<Record<string, DynamicComponentInstance>>;
  /**
   * Component instances indexed by `definition id - #idBase`, or `null` when this world's definition ids are too
   * spread out for a compact array. Definition ids are process-global, so indexing by the raw id would leave a
   * holey (or dictionary-mode) array in a long-lived process.
   */
  #registryByIdOffset: (DynamicComponentInstance | undefined)[] | null;
  /** Smallest registered definition id: the offset of {@link #registryByIdOffset}. */
  #idBase: number;
  /** Component instances by definition, used when {@link #registryByIdOffset} is `null`. */
  #registryByComponent: Map<DynamicComponent, DynamicComponentInstance> | null;
  /** Component ownership and changed state indexed by component instance id */
  #states: ComponentState[];
  /** States with string / object fields, whose staged side values refresh releases */
  #sideStates: ComponentState[];
  /** World revision bump callback */
  #nextWorldRevision: () => number;
  /** Canonical entity liveness check supplied by the owning world. */
  #isActive: (entity: Entity) => boolean;
  /** Tracking callbacks used by rollback restore (allocated once). */
  readonly #snapshotHooks: ComponentSnapshotRestoreHooks = {
    ownerFlags: (state) => this.#ownerFlags(state),
    reserveSparseSlot: (state, flags, slot) => this.#reserveSparseSlot(state, flags, slot),
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
    this.#isActive = isActive;
    this.#registryByName = Object.create(null);
    this.#publicRegistry = {};
    this.#states = [];
    this.#sideStates = [];
    for (const component of components) {
      const id = this.#states.length;
      const state = createComponentState(component, id, capacity, this.#buffer, {
        packSlot,
        isEntityActive: isActive,
        has: (entity) => this.#entityOwnsInstanceId(id, entity),
        markChanged: (entity) => this.#markInstanceIdChanged(id, entity),
        markSlotChanged: (slot) => {
          // Only owners are tracked: raw writes to non-owner slots are an unguarded escape hatch.
          const state = this.#states[id];
          if (state !== undefined && state.ownerFlags?.[slot] === 1) this.#markChanged(state, slot);
        },
        getRevision: () => this.#states[id]?.revision ?? 0,
      });
      this.#states.push(state);
      if (state.sideKeys.length > 0) this.#sideStates.push(state);
      this.#registryByName[component.name] = state.instance;
    }
    this.#publicRegistry = Object.freeze({ ...this.#registryByName });
    // Index instances by definition id. A packed, offset array is the fastest lookup; it is used whenever the ids
    // span little more than the component count (the usual case: components defined together, then worlds built).
    let idBase = 0;
    let span = 0;
    if (components.length > 0) {
      let maxId = -Infinity;
      idBase = Infinity;
      for (const component of components) {
        const id = component[$_COMPONENT_ID_KEY];
        if (id < idBase) idBase = id;
        if (id > maxId) maxId = id;
      }
      span = maxId - idBase + 1;
    }
    this.#idBase = idBase;
    if (span <= components.length * 4 + 64) {
      // Filled by `push` so the array stays packed.
      const byOffset: (DynamicComponentInstance | undefined)[] = [];
      for (let i = 0; i < span; i++) byOffset.push(undefined);
      for (const state of this.#states) byOffset[state.instance.type[$_COMPONENT_ID_KEY] - idBase] = state.instance;
      this.#registryByIdOffset = byOffset;
      this.#registryByComponent = null;
    } else {
      this.#registryByIdOffset = null;
      this.#registryByComponent = new Map(this.#states.map((state) => [state.instance.type, state.instance]));
    }
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

  /** Issue fresh revision tokens for a change tracked outside component storage (relation pairs). @internal */
  bumpInstanceRevision(instance: DynamicComponentInstance): void {
    const state = this.#states[instance.id];
    if (state !== undefined) this.#bumpRevision(state);
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

  /** The owner flags of a component, allocated when it first gains an owner. */
  #ownerFlags(state: ComponentState): Uint8Array {
    let flags = state.ownerFlags;
    if (flags === null) {
      flags = new Uint8Array(this.#capacity);
      state.ownerFlags = flags;
    }
    return flags;
  }

  /**
   * Make `slot` a new owner: {@link #prepareOwner} when the component needs it, then flag, list and bump.
   * @param template - Side values from a compiled template row, or `undefined` for per-owner defaults
   */
  #claimOwner(
    state: ComponentState,
    flags: Uint8Array,
    slot: number,
    data: Record<string, unknown> | undefined,
    template: readonly unknown[] | undefined,
  ): void {
    // Uncapped, dense, side-free components (the common case) have nothing to prepare.
    if (state.needsOwnerPreparation) this.#prepareOwner(state, flags, slot, data, template);
    flags[slot] = 1;
    state.owners.add(slot);
    this.#bumpRevision(state);
  }

  /**
   * Every step of a new owner that can throw, run before ownership changes: check the cap, stage absent side
   * fields (`create()` / `clone()` hooks) and map a capped row.
   */
  #prepareOwner(
    state: ComponentState,
    flags: Uint8Array,
    slot: number,
    data: Record<string, unknown> | undefined,
    template: readonly unknown[] | undefined,
  ): void {
    const maxOwners = state.maxOwners;
    if (maxOwners !== 0 && state.owners.count >= maxOwners) {
      // The add is discarded, and so is the data staged for it.
      this.#releaseSideScratch(state);
      throw maxOwnersError(state.instance.type.name, maxOwners);
    }
    if (state.sideKeys.length > 0) this.#stageSideInitial(state, data, template);
    if (state.usesSparseStorage) this.#reserveSparseSlot(state, flags, slot);
  }

  /** Mark a data component changed once per entity per refresh window. */
  #markChanged(state: ComponentState, slot: number): void {
    this.#bumpRevision(state);
    const changed = state.changed;
    if (state.instance.storage === null || changed.has(slot)) return;
    changed.add(slot);
  }

  /** Mark a data component changed by instance id if the entity owns it. */
  #markInstanceIdChanged(instanceId: number, entity: Entity): boolean {
    const state = this.#states[instanceId];
    if (state === undefined || state.instance.storage === null) return false;
    if (!this.#entityOwnsInstanceId(instanceId, entity)) return false;
    this.#markChanged(state, entityIndex(entity));
    return true;
  }

  /**
   * Map a capped component's dense row for `slot` before ownership changes, so a storage failure can never leave a
   * half-committed add. Raw writes to non-owner slots (direct partitions, proxy slot cursor) map rows too and
   * are never released by removal; when the dense rows run out they are reclaimed here, after which at most
   * `owners.count` rows are mapped and `owners.count < maxOwners` guarantees room.
   */
  #reserveSparseSlot(state: ComponentState, flags: Uint8Array, slot: number): void {
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
      if (flags[other] !== 1 && other !== slot && getEntity(other) !== undefined) column.deleteEntity(other);
    }
    column.setEntity(slot, 0);
  }

  /** Reset one entity's component storage slot to its default empty value. */
  #clearEntityStorage(state: ComponentState, slot: number): void {
    const columns = state.storageColumns;
    const defaults = state.storageDefaults;
    for (let i = 0; i < columns.length; i++) columns[i]![slot] = defaults[i]!;
    const sideColumns = state.sideColumns;
    for (let i = 0; i < sideColumns.length; i++) sideColumns[i]![slot] = state.sideInitial[i];
  }

  /**
   * Stage the values a new owner's absent side fields start at, skipping fields `data` provides: a template value
   * copied through the field's `clone` hook, else `create()` for object fields that define it, else `""` / `null`.
   * Runs before ownership changes, so a throwing hook leaves the component untouched.
   */
  #stageSideInitial(
    state: ComponentState,
    data: Record<string, unknown> | undefined,
    template: readonly unknown[] | undefined,
  ): void {
    const fields = state.sideFields;
    const keys = state.sideKeys;
    const initial = state.sideInitial;
    try {
      for (let i = 0; i < fields.length; i++) {
        if (data !== undefined && hasOwnProperty(data, keys[i]!)) continue;
        const property = fields[i]!;
        const value = template === undefined ? undefined : template[i];
        if (property.kind === "string") {
          initial[i] = value === undefined ? sideDefault(property) : value;
          continue;
        }
        if (value === undefined) {
          const create = property.create;
          initial[i] = create === undefined ? sideDefault(property) : create();
          continue;
        }
        const clone = property.clone;
        initial[i] = value === null || clone === undefined ? value : clone(value);
      }
    } catch (error) {
      // Values staged before the throw must not stay referenced, nor the discarded add's staged data.
      this.#clearSideInitial(state);
      this.#releaseSideScratch(state);
      throw error;
    }
  }

  /** Drop staged initial values so they do not keep objects alive. */
  #clearSideInitial(state: ComponentState): void {
    const initial = state.sideInitial;
    for (let i = 0; i < initial.length; i++) initial[i] = undefined;
  }

  /** Drop staged side values once committed, so they do not keep objects alive until {@link refresh}. */
  #releaseSideScratch(state: ComponentState): void {
    const scratch = state.sideScratch;
    for (let i = 0; i < scratch.length; i++) scratch[i] = undefined;
  }

  /**
   * Release the side (string / object) values {@link validateInstanceData} staged for a component. Call once a path
   * that validates first is done with them: after its last write, or when it discards them. {@link refresh} also
   * releases them, as a backstop.
   * @param instanceId - The registered component instance id
   * @internal
   */
  releaseStagedData(instanceId: number): void {
    const state = this.#states[instanceId];
    if (state !== undefined) this.#releaseSideScratch(state);
  }

  /** Reset an unowned slot's side cells so the component no longer holds its strings / objects. */
  #releaseSideCells(state: ComponentState, slot: number): void {
    const columns = state.sideColumns;
    for (let i = 0; i < columns.length; i++) columns[i]![slot] = sideDefault(state.sideFields[i]!);
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
   * @param dataValidated - When true, the caller already staged canonical values with validateInstanceData and
   *   releases them with {@link releaseStagedData}. Either way, a throw after staging releases them here.
   * @returns `true` if the component ownership changed
   * @internal
   */
  addInstanceToEntity<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
    data?: Partial<Record<keyof TValue, unknown>>,
    slot: number = entityIndex(entity),
    dataValidated: boolean = false,
  ): boolean {
    if (slot >= this.#capacity) {
      throw new EntityNotFoundError(`Entity ${entity} is outside component capacity.`);
    }
    const state = this.#states[instance.id];
    if (state === undefined) return false;
    if (data !== undefined && !dataValidated) this.validateInstanceData(instance, data);
    const values = data as Record<string, unknown> | undefined;
    const flags = this.#ownerFlags(state);
    const ownershipChanged = flags[slot] !== 1;
    if (ownershipChanged) this.#claimOwner(state, flags, slot, values, undefined);
    if (instance.storage !== null) {
      if (values !== undefined) {
        const changed = writeEntityStorageData(state, values, slot, ownershipChanged);
        // A payload always marks a new owner changed, whatever the previous (default, stale, or unmapped) cell held.
        if (changed || ownershipChanged) this.#markChanged(state, slot);
      } else if (ownershipChanged) {
        // A no-payload attach resets the row to its defaults and is a change, exactly like an explicit payload.
        this.#clearEntityStorage(state, slot);
        this.#markChanged(state, slot);
      }
    }
    if (ownershipChanged && state.sideKeys.length > 0) this.#clearSideInitial(state);
    // Data staged here is used once; batch callers stage once (`dataValidated`) and release after their last row.
    if (values !== undefined && !dataValidated) this.#releaseSideScratch(state);
    return ownershipChanged;
  }

  /**
   * Add a registered component instance to a newly created entity, filling its row from template defaults.
   *
   * Ownership, capped-row reservation, revision and changed tracking follow {@link addInstanceToEntity}; only the
   * value source differs. Fields that `data` provides take the canonical values staged by
   * {@link validateInstanceData}; every other field takes its template default. Side (string / object) defaults are
   * copied through the field's `clone` hook; an absent object default calls `create()` for each new owner.
   *
   * @param instance - The registered component instance
   * @param slot - The new entity's storage slot (must not own the instance yet)
   * @param row - A row compiled by {@link compileTemplateRow}, or `null` for tags
   * @param data - Optional validated override payload
   * @returns `true` if the component ownership changed
   * @internal
   */
  addInstanceWithRow(
    instance: DynamicComponentInstance,
    slot: number,
    row: ComponentTemplateRow | null,
    data: Record<string, unknown> | undefined,
  ): boolean {
    const state = this.#states[instance.id];
    if (state === undefined) return false;
    const flags = this.#ownerFlags(state);
    if (flags[slot] === 1) return false;
    // Only data components have rows, so a tag (`row === null`) has no side fields to stage.
    this.#claimOwner(state, flags, slot, data, row?.side);
    if (row !== null) {
      writeEntityStorageRow(state, row.typed, data, slot);
      if (state.sideKeys.length > 0) this.#clearSideInitial(state);
      this.#markChanged(state, slot);
    }
    return true;
  }

  /**
   * Compile template defaults (logical values keyed by field name) against this world's column layout.
   * @param values - Canonical logical values; absent side fields take their per-owner default
   * @returns raw typed-column values parallel to the storage keys, and side values (`undefined` when absent)
   * @internal
   */
  compileTemplateRow(
    instance: DynamicComponentInstance,
    values: Readonly<Record<string, unknown>>,
  ): ComponentTemplateRow {
    const state = this.#states[instance.id]!;
    const name = instance.type.name;
    const typed = state.storageKeys.map((key, i) => {
      const codec = state.storageCodecs[i]!;
      const value = values[key];
      if (codec === null) return value as number;
      return encodeFieldValue(codec, name, key, value, state.isEntityActive);
    });
    const side = state.sideKeys.map((key) => hasOwnProperty(values, key) ? values[key] : undefined);
    return { typed, side };
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
    const byOffset = this.#registryByIdOffset;
    if (byOffset === null) return this.#registryByComponent!.get(component);
    const index = component[$_COMPONENT_ID_KEY] - this.#idBase;
    return index >= 0 && index < byOffset.length ? byOffset[index] : undefined;
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
    return this.#isActive(entity) && this.#states[instanceId]?.ownerFlags?.[entityIndex(entity)] === 1;
  }

  /**
   * Get a registered component instance
   * @param component - The component to get the instance of
   * @returns The component instance
   * @throws {NotRegisteredError} If the component is not registered
   */
  getInstanceOrThrow(component: string): DynamicComponentInstance;
  getInstanceOrThrow<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage>): ComponentInstance<TValue, TStorage>;
  getInstanceOrThrow<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): ComponentInstance<TValue, TStorage> | DynamicComponentInstance;
  getInstanceOrThrow(component: DynamicComponent | string): DynamicComponentInstance {
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
   * @returns An iterable of entities
   * @throws {NotRegisteredError} If the component is not registered
   */
  getChanged<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): IterableIterator<Entity> {
    const state = this.#states[this.getInstanceOrThrow(component).id]!;
    return state.changed.iterator.reset(state.changed.count);
  }

  /**
   * Get an iterable of all entities with a given component
   * @param component The component to get entities for
   * @returns An iterable of entities
   * @throws {NotRegisteredError} If the component is not registered
   */
  getOwners<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): IterableIterator<Entity> {
    const state = this.#states[this.getInstanceOrThrow(component).id]!;
    return state.owners.iterator.reset(state.owners.count);
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
    return this.#states[instance.id]?.owners.count ?? 0;
  }

  /**
   * Preflight capacity for adding a set of registered component instances to one entity.
   * @param entries - Unique registered component instances and optional data
   * @param entity - The target entity, or undefined to preflight a fresh owner before entity creation
   * @throws {EntityNotFoundError} If the entity is out of component capacity
   * @throws {CapacityError} If any max owner count would overflow
   * @internal
   */
  preflightAddBundleToEntity(
    entries: readonly ComponentBundleCommitEntry[],
    entity: Entity | undefined,
    count: number = entries.length,
  ): void {
    if (entity !== undefined && entityIndex(entity) >= this.#capacity) {
      throw new EntityNotFoundError(`Entity ${entity} is outside component capacity.`);
    }
    for (let i = 0; i < count; i++) {
      const instance = entries[i]!.instance;
      const state = this.#states[instance.id];
      const maxOwners = state?.maxOwners ?? 0;
      if (
        state === undefined || maxOwners === 0 ||
        (entity !== undefined && state.ownerFlags?.[entityIndex(entity)] === 1)
      ) continue;
      if (state.owners.count >= maxOwners) {
        throw maxOwnersError(instance.type.name, maxOwners);
      }
    }
  }

  /** Preflight max-owner capacity for adding one component to a dense entity list. */
  preflightAddInstanceToEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(instance: ComponentInstance<TValue, TStorage>, entities: EntityArray, count: number): void {
    const state = this.#states[instance.id];
    const maxOwners = state?.maxOwners ?? 0;
    if (state === undefined || maxOwners === 0) return;

    let newOwners = 0;
    for (let i = 0; i < count; i++) {
      if (state.ownerFlags?.[entityIndex(entities[i]! as Entity)] !== 1) newOwners++;
    }
    if (state.owners.count + newOwners > maxOwners) {
      throw maxOwnersError(instance.type.name, maxOwners);
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
    const slot = entityIndex(entity);
    for (let i = 0; i < count; i++) {
      const { data, instance } = entries[i]!;
      const added = this.addInstanceToEntity(
        instance,
        entity,
        data as Partial<Record<PropertyKey, unknown>> | undefined,
        slot,
        true,
      );
      // Entries are unique, so each entry's staged data is done with once its row is written.
      if (data !== undefined) this.releaseStagedData(instance.id);
      if (added) addedOut[addedCount++] = instance;
    }
    return addedCount;
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
    if (state.hasFieldColumns) {
      const decoded: Record<string, unknown> = {};
      this.#readFieldRow(state, slot, decoded);
      return decoded as ComponentData<TValue>;
    }
    const defaults = state.storageDefaults;
    const result: Record<string, number> = {};
    // Owned rows are always mapped; the default only guards an unmapped sparse row, never decoding as `true`.
    for (let i = 0; i < keys.length; i++) result[keys[i]!] = columns[i]![slot] ?? defaults[i]!;
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
    const slot = entityIndex(entity);
    if (state.hasFieldColumns) {
      this.#readFieldRow(state, slot, out as Record<string, unknown>);
      return true;
    }
    const target = out as Record<string, number>;
    const keys = state.storageKeys;
    const columns = state.storageColumns;
    const defaults = state.storageDefaults;
    for (let i = 0; i < keys.length; i++) target[keys[i]!] = columns[i]![slot] ?? defaults[i]!;
    return true;
  }

  /** Decode one row of a component with `field.*` columns: typed columns first, then side columns. */
  #readFieldRow(state: ComponentState, slot: number, target: Record<string, unknown>): void {
    const keys = state.storageKeys;
    const columns = state.storageColumns;
    const codecs = state.storageCodecs;
    const defaults = state.storageDefaults;
    const isActive = state.isEntityActive;
    for (let i = 0; i < keys.length; i++) {
      const raw = columns[i]![slot] ?? defaults[i]!;
      const codec = codecs[i]!;
      target[keys[i]!] = codec === null ? raw : decodeFieldValue(codec, raw, isActive);
    }
    const sideKeys = state.sideKeys;
    const sideColumns = state.sideColumns;
    for (let i = 0; i < sideKeys.length; i++) target[sideKeys[i]!] = sideColumns[i]![slot];
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
    for (let i = 0; i < this.#states.length; i++) this.#states[i]!.changed.clear();
    // Batch writes (one staging, many rows) leave staged side values behind; drop them so they do not keep objects alive.
    const sideStates = this.#sideStates;
    for (let i = 0; i < sideStates.length; i++) this.#releaseSideScratch(sideStates[i]!);
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
    const state = this.#states[instance.id];
    if (state === undefined) return false;
    const flags = state.ownerFlags;
    if (flags === null || flags[slot] !== 1) return false;

    state.owners.remove(slot);
    flags[slot] = 0;
    // Tag components never enter the changed window.
    if (instance.storage !== null) {
      const changed = state.changed;
      if (changed.has(slot)) changed.remove(slot);
    }
    this.#bumpRevision(state);
    // Every column of a capped component shares one slot -> row index, so one delete unmaps the whole row.
    if (state.usesSparseStorage) (state.storageColumns[0] as SparseColumn).deleteEntity(slot);
    if (state.sideKeys.length > 0) this.#releaseSideCells(state, slot);
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
    value: Partial<Record<keyof TValue, unknown>>,
  ): this {
    if (instance.storage === null) return this;
    this.validateInstanceData(instance, value);
    const state = this.#states[instance.id]!;
    const slot = entityIndex(entity);
    const changed = writeEntityStorageData(state, value as Record<string, unknown>, slot, false);
    this.#releaseSideScratch(state);
    if (changed && state.ownerFlags?.[slot] === 1) this.#markChanged(state, slot);
    return this;
  }

  /** Capture a full ownership + column snapshot for rollback. */
  captureSnapshot(): ComponentManagerSnapshot {
    return captureComponentManagerSnapshot(this.#states);
  }

  /** Component states in registration (instance id) order, read by world saves. @internal */
  get saveStates(): readonly ComponentState[] {
    return this.#states;
  }

  /** Restore a full ownership + column snapshot for rollback. */
  restoreSnapshot(snapshot: ComponentManagerSnapshot): void {
    restoreComponentManagerSnapshot(this.#states, snapshot, this.#snapshotHooks);
  }
}
