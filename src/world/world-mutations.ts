import type { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { ComponentBundleCommitEntry, ComponentManager } from "@/component/component-manager.ts";
import {
  createEntityArray,
  createSlotArray,
  type Entity,
  type EntityArray,
  entityIndex,
  type QueryEntityList,
} from "@/entity/entity.ts";
import type { EntityManager } from "@/entity/entity-manager.ts";
import {
  CapacityError,
  ComponentDataError,
  componentDisplayName,
  EntityNotFoundError,
  formatComponentNotRegistered,
  formatEntityNotActive,
  NotRegisteredError,
} from "@/errors.ts";
import type { SchemaOrNull } from "@/types/partitions.ts";
import type { ComponentBundleEntryInput } from "@/types/world-api.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";

type ComponentReference<
  TValue extends SchemaOrNull,
  TStorage extends SchemaOrNull = TValue,
> = Component<TValue, TStorage> | string;

type ComponentDataInput<TValue extends SchemaOrNull> = Partial<Record<keyof TValue, number>>;

/** Dependencies required by {@link WorldMutations}. */
export type WorldMutationsDeps = {
  readonly entityManager: EntityManager;
  readonly componentManager: ComponentManager;
  readonly archetypeManager: ArchetypeManager;
  readonly capacity: number;
  readonly componentCount: number;
  readonly isInitialized: () => boolean;
  readonly invalidateQueries: () => void;
};

/**
 * Owns batch/bundle entity-component mutation logic for a World.
 * Constructed by World and invoked from its public API facades.
 */
export class WorldMutations {
  #entityManager: EntityManager;
  readonly #componentManager: ComponentManager;
  readonly #archetypeManager: ArchetypeManager;
  readonly #isInitialized: () => boolean;
  readonly #invalidateQueries: () => void;

  /** Dense scratch storage for preflighted batch component transitions (packed handles) */
  readonly #batchEntities: EntityArray;

  /** Dense scratch storage for preflighted batch component transitions (slots) */
  readonly #batchSlots: EntityArray;

  /** Duplicate-detection scratch flags for preflighted batch component transitions */
  readonly #batchSeen: Uint8Array;

  /** Reusable preflighted bundle entries */
  readonly #bundleEntries: ComponentBundleCommitEntry[];

  /** Duplicate-detection scratch flags for bundle component instances */
  readonly #bundleSeenComponents: Uint8Array;

  constructor(deps: WorldMutationsDeps) {
    this.#entityManager = deps.entityManager;
    this.#componentManager = deps.componentManager;
    this.#archetypeManager = deps.archetypeManager;
    this.#isInitialized = deps.isInitialized;
    this.#invalidateQueries = deps.invalidateQueries;
    this.#batchEntities = createEntityArray(deps.capacity);
    this.#batchSlots = createSlotArray(deps.capacity);
    this.#batchSeen = new Uint8Array(deps.capacity);
    this.#bundleEntries = [];
    this.#bundleSeenComponents = new Uint8Array(deps.componentCount);
  }

  /** Resolve a registered component instance for mutation paths. */
  getRegisteredComponentInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: ComponentReference<TValue, TStorage>): ComponentInstance<TValue, TStorage> {
    const instance = this.#componentManager.getInstance(component);
    if (instance !== undefined) return instance as ComponentInstance<TValue, TStorage>;
    throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component)));
  }

  /** Validate a public component data payload before any ownership/storage mutation. */
  validateComponentData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    instance: ComponentInstance<TValue, TStorage>,
    data: unknown,
  ): void {
    if (data === undefined) return;
    if (instance.storage === null) {
      throw new ComponentDataError(`Component ${instance.type.name} has no data storage.`);
    }
    if (!isObject(data)) {
      throw new TypeError(`Component data for "${instance.type.name}" must be an object.`);
    }

    const knownKeys = this.#componentManager.getStorageKeyLookup(instance);
    if (knownKeys === undefined) {
      throw new ComponentDataError(`Component ${instance.type.name} has no data storage.`);
    }
    const values = data as Record<string, unknown>;
    for (const key in values) {
      if (!hasOwnProperty(values, key)) continue;
      if (knownKeys[key] !== 1) {
        throw new ComponentDataError(`Component ${instance.type.name} does not define data field "${key}".`);
      }
      const value = values[key];
      if (value === undefined) {
        throw new ComponentDataError(`Component ${instance.type.name} data field "${key}" cannot be undefined.`);
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ComponentDataError(`Component ${instance.type.name} data field "${key}" must be a finite number.`);
      }
    }
  }

  /** Invalidate entity query caches once for a committed ownership transition batch. */
  invalidateCommittedTransition(changed: boolean): void {
    if (changed && this.#isInitialized()) {
      this.#invalidateQueries();
    }
  }

  /** Replace the entity manager after world rollback restore. */
  replaceEntityManager(entityManager: EntityManager): void {
    this.#entityManager = entityManager;
  }

  /** Create an active entity and attach it to the root archetype. */
  createEntity(): Entity | undefined {
    const entity = this.#entityManager.create();
    if (entity === undefined) return undefined;
    this.#archetypeManager.createEntity(entity);
    this.invalidateCommittedTransition(true);
    return entity;
  }

  /** Create an entity and atomically attach a bundle. */
  createEntityWithBundle(
    bundle: readonly ComponentBundleEntryInput[],
    throwOnCapacity: boolean,
  ): Entity | undefined {
    const entity = this.createEntity();
    if (entity === undefined) {
      if (throwOnCapacity) {
        throw new CapacityError(`World is at capacity (${this.#entityManager.capacity} entities).`);
      }
      return undefined;
    }

    try {
      this.addBundleToEntity(entity, bundle);
      return entity;
    } catch (error) {
      this.#rollbackCreatedEntity(entity);
      throw error;
    }
  }

  /** Add a preflighted component bundle to an active entity. */
  addBundleToEntity(entity: Entity, bundle: readonly ComponentBundleEntryInput[]): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const entries = this.#preflightBundle(bundle);
    try {
      this.#componentManager.preflightAddBundleToEntity(entries, entity);
      const added = this.#componentManager.addBundleToEntity(entries, entity);
      if (added.length > 0) {
        this.#archetypeManager.addComponentSet(entity, added);
      }
      this.invalidateCommittedTransition(added.length > 0);
    } finally {
      this.#clearBundleEntries();
    }
  }

  /** Add a component to an entity */
  addComponentToEntity<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
    data?: ComponentDataInput<TValue> | undefined,
  ): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const instance = this.getRegisteredComponentInstance(component);
    this.validateComponentData(instance, data);
    const changed = this.#commitAddComponent(instance, entity, data, true);
    this.invalidateCommittedTransition(changed);
  }

  /** Add a component to every entity in a dense query list. */
  addComponentToEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entities: QueryEntityList,
    data?: ComponentDataInput<TValue> | undefined,
  ): number {
    const instance = this.getRegisteredComponentInstance(component);
    this.validateComponentData(instance, data);
    const count = this.#preflightBatchEntities(entities);

    try {
      this.#componentManager.preflightAddInstanceToEntities(instance, this.#batchEntities, count);
      let changedCount = 0;
      for (let i = 0; i < count; i++) {
        if (
          this.#componentManager.addInstanceToEntity(
            instance,
            this.#batchEntities[i]!,
            data,
            this.#batchSlots[i]!,
            true,
          )
        ) {
          changedCount++;
        }
      }
      if (changedCount > 0) {
        this.#archetypeManager.addComponents(this.#batchSlots, count, instance);
      }
      this.invalidateCommittedTransition(changedCount > 0);
      return changedCount;
    } finally {
      this.#clearBatchEntities(count);
    }
  }

  /** Remove a component from an entity */
  removeComponentFromEntity<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const changed = this.#commitRemoveComponent(this.getRegisteredComponentInstance(component), entity);
    this.invalidateCommittedTransition(changed);
  }

  /** Remove a component from every entity in a dense query list. */
  removeComponentFromEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entities: QueryEntityList,
  ): number {
    const instance = this.getRegisteredComponentInstance(component);
    const count = this.#preflightBatchEntities(entities);

    try {
      let changedCount = 0;
      for (let i = 0; i < count; i++) {
        if (this.#componentManager.removeInstanceFromEntity(instance, this.#batchEntities[i]!)) {
          changedCount++;
        }
      }
      if (changedCount > 0) {
        this.#archetypeManager.removeComponents(this.#batchSlots, count, instance);
      }
      this.invalidateCommittedTransition(changedCount > 0);
      return changedCount;
    } finally {
      this.#clearBatchEntities(count);
    }
  }

  /** Preflight a borrowed dense entity list before an atomic batch mutation. */
  #preflightBatchEntities(entities: QueryEntityList): number {
    const count = entities.count;
    if (!Number.isInteger(count) || count < 0 || count > this.#batchEntities.length) {
      throw new RangeError(`Batch entity list count ${count} is outside world capacity.`);
    }

    for (let i = 0; i < count; i++) {
      const entity = entities.entities[i]!;
      if (!this.#entityManager.isActive(entity)) {
        this.#clearBatchEntities(i);
        throw new EntityNotFoundError(formatEntityNotActive(entity));
      }
      const slot = entities.indices[i]!;
      if (this.#batchSeen[slot] === 1) {
        this.#clearBatchEntities(i);
        throw new RangeError(`Duplicate entity ${entity} in batch entity list.`);
      }
      this.#batchSeen[slot] = 1;
      this.#batchEntities[i] = entity;
      this.#batchSlots[i] = slot;
    }

    return count;
  }

  /** Clear duplicate-detection scratch flags after batch preflight/commit. */
  #clearBatchEntities(count: number): void {
    for (let i = 0; i < count; i++) {
      this.#batchSeen[this.#batchSlots[i]!] = 0;
      this.#batchEntities[i] = 0;
      this.#batchSlots[i] = 0;
    }
  }

  /** Clear bundle duplicate-detection scratch state. */
  #clearBundleEntries(): void {
    for (let i = 0; i < this.#bundleEntries.length; i++) {
      const instance = this.#bundleEntries[i]!.instance;
      this.#bundleSeenComponents[instance.id] = 0;
    }
    this.#bundleEntries.length = 0;
  }

  /** Resolve, validate, and stage a user-provided bundle before mutation. */
  #preflightBundle(bundle: readonly ComponentBundleEntryInput[]): readonly ComponentBundleCommitEntry[] {
    try {
      for (let i = 0; i < bundle.length; i++) {
        const entry = bundle[i];
        if (!Array.isArray(entry) || (entry.length !== 1 && entry.length !== 2)) {
          throw new TypeError("Bundle entries must be [component] or [component, data] tuples.");
        }
        const instance = this.getRegisteredComponentInstance(entry[0]);
        if (this.#bundleSeenComponents[instance.id] === 1) {
          throw new RangeError(`Duplicate component "${instance.type.name}" in bundle.`);
        }
        this.#bundleSeenComponents[instance.id] = 1;

        let data: Partial<Record<string, number>> | undefined;
        if (entry.length === 2) {
          this.validateComponentData(instance, entry[1]);
          data = entry[1] as Partial<Record<string, number>> | undefined;
        }

        this.#bundleEntries.push({ instance, data });
      }
      return this.#bundleEntries;
    } catch (error) {
      this.#clearBundleEntries();
      throw error;
    }
  }

  /** Roll back a newly-created entity after bundle preflight fails. */
  #rollbackCreatedEntity(entity: Entity): void {
    let changed = this.#archetypeManager.getEntityArchetype(entity) !== undefined;
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
    if (archetype) {
      const components = archetype.components;
      for (let i = 0; i < components.length; i++) {
        changed ||= this.#componentManager.removeInstanceFromEntity(components[i]!, entity);
      }
    }
    this.#archetypeManager.destroyEntity(entity);
    if (this.#entityManager.isActive(entity)) {
      this.#entityManager.destroy(entity);
    }
    this.invalidateCommittedTransition(changed);
  }

  /** Commit an already preflighted component add. */
  #commitAddComponent<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
    data?: ComponentDataInput<TValue>,
    dataValidated: boolean = false,
  ): boolean {
    const slot = entityIndex(entity);
    const changed = this.#componentManager.addInstanceToEntity(instance, entity, data, slot, dataValidated);
    if (changed) {
      this.#archetypeManager.addComponent(entity, instance, slot);
    }
    return changed;
  }

  /** Commit an already preflighted component removal. */
  #commitRemoveComponent<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
  ): boolean {
    const slot = entityIndex(entity);
    const changed = this.#componentManager.removeInstanceFromEntity(instance, entity, slot);
    if (changed) {
      this.#archetypeManager.removeComponent(entity, instance, slot);
    }
    return changed;
  }
}
