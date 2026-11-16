import type { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { ComponentBundleCommitEntry, ComponentManager } from "@/component/component-manager.ts";
import {
  asEntity,
  asSlotIndex,
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
  componentDisplayName,
  EntityNotFoundError,
  formatComponentNotRegistered,
  formatEntityNotActive,
  NotRegisteredError,
} from "@/errors.ts";
import type { SchemaOrNull } from "@/types/partitions.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { ComponentBundleEntryInput } from "@/types/world-api.ts";

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
  readonly notifyEntityLifecycle: () => void;
};

/**
 * Owns batch/bundle entity-component mutation logic for a World.
 * Constructed by World and invoked from its public API facades.
 */
export class WorldMutations {
  readonly #entityManager: EntityManager;
  readonly #componentManager: ComponentManager;
  readonly #archetypeManager: ArchetypeManager;
  readonly #isInitialized: () => boolean;
  readonly #invalidateQueries: () => void;
  readonly #notifyEntityLifecycle: () => void;

  /** Dense scratch storage for preflighted batch component transitions (packed handles) */
  readonly #batchEntities: EntityArray;

  /** Dense scratch storage for preflighted batch component transitions (slots) */
  readonly #batchSlots: EntityArray;

  /** Duplicate-detection scratch flags for preflighted batch component transitions */
  readonly #batchSeen: Uint8Array;

  /** Reusable preflighted bundle entries (objects pooled across calls) */
  readonly #bundleEntries: ComponentBundleCommitEntry[];

  /** Active prefix length of {@link #bundleEntries} for the current preflight */
  #bundleEntryCount: number;

  /** Reusable ownership-changed scratch for bundle commits */
  readonly #bundleAdded: DynamicComponentInstance[];

  /** Duplicate-detection scratch flags for bundle component instances */
  readonly #bundleSeenComponents: Uint8Array;

  constructor(deps: WorldMutationsDeps) {
    this.#entityManager = deps.entityManager;
    this.#componentManager = deps.componentManager;
    this.#archetypeManager = deps.archetypeManager;
    this.#isInitialized = deps.isInitialized;
    this.#invalidateQueries = deps.invalidateQueries;
    this.#notifyEntityLifecycle = deps.notifyEntityLifecycle;
    this.#batchEntities = createEntityArray(deps.capacity);
    this.#batchSlots = createSlotArray(deps.capacity);
    this.#batchSeen = new Uint8Array(deps.capacity);
    this.#bundleEntries = [];
    this.#bundleEntryCount = 0;
    this.#bundleAdded = [];
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
    this.#componentManager.validateInstanceData(instance, data);
  }

  /** Invalidate entity query caches once for a committed ownership transition batch. */
  invalidateCommittedTransition(changed: boolean): void {
    if (changed && this.#isInitialized()) {
      this.#invalidateQueries();
    }
  }

  /** Create an active entity and attach it to the root archetype. */
  createEntity(): Entity | undefined {
    const entity = this.#entityManager.create();
    if (entity === undefined) return undefined;
    this.#archetypeManager.createEntity(entity);
    this.#notifyEntityLifecycle();
    this.invalidateCommittedTransition(true);
    return entity;
  }

  /**
   * Create an entity and atomically attach a bundle.
   * The bundle is validated before capacity is checked, and the entity is placed straight into its
   * final archetype so it is never observed in (or reported as exiting) the root archetype.
   */
  createEntityWithBundle(
    bundle: readonly ComponentBundleEntryInput[],
    throwOnCapacity: boolean,
  ): Entity | undefined {
    const count = this.#preflightBundle(bundle);
    let entity: Entity | undefined;
    try {
      this.#componentManager.preflightAddBundleToEntity(this.#bundleEntries, undefined, count);
      if (this.#entityManager.getAvailableCount() === 0) {
        if (throwOnCapacity) {
          throw new CapacityError(`World is at capacity (${this.#entityManager.capacity} entities).`);
        }
        return undefined;
      }
      entity = this.#entityManager.create()!;
      const addedCount = this.#componentManager.addBundleToEntity(
        this.#bundleEntries,
        entity,
        count,
        this.#bundleAdded,
      );
      if (addedCount > 0) {
        this.#archetypeManager.addComponentSet(entity, this.#bundleAdded, addedCount);
      } else {
        this.#archetypeManager.createEntity(entity);
      }
      this.#notifyEntityLifecycle();
      this.invalidateCommittedTransition(true);
      return entity;
    } catch (error) {
      if (entity !== undefined) this.#rollbackCreatedEntity(entity, count);
      throw error;
    } finally {
      this.#clearBundleEntries();
    }
  }

  /** Add a preflighted component bundle to an active entity. */
  addBundleToEntity(entity: Entity, bundle: readonly ComponentBundleEntryInput[]): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    if (bundle.length === 0) return;
    const count = this.#preflightBundle(bundle);
    try {
      this.#componentManager.preflightAddBundleToEntity(this.#bundleEntries, entity, count);
      this.#commitBundleToEntity(entity, count);
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
            asEntity(this.#batchEntities[i]!),
            data,
            asSlotIndex(this.#batchSlots[i]!),
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
        if (this.#componentManager.removeInstanceFromEntity(instance, asEntity(this.#batchEntities[i]!))) {
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
    if (!entities || !entities.entities || !entities.slots) {
      throw new TypeError("Batch entity list must include entity and slot buffers.");
    }
    const count = entities.count;
    if (!Number.isInteger(count) || count < 0 || count > this.#batchEntities.length) {
      throw new RangeError(`Batch entity list count ${count} is outside world capacity.`);
    }

    for (let i = 0; i < count; i++) {
      const entity = asEntity(entities.entities[i]!);
      if (!this.#entityManager.isActive(entity)) {
        this.#clearBatchEntities(i);
        throw new EntityNotFoundError(formatEntityNotActive(entity));
      }
      const slot = entityIndex(entity);
      if (entities.slots[i] !== slot) {
        this.#clearBatchEntities(i);
        throw new RangeError(`Batch entity ${entity} has an invalid storage slot.`);
      }
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
    for (let i = 0; i < this.#bundleEntryCount; i++) {
      const entry = this.#bundleEntries[i]!;
      this.#bundleSeenComponents[entry.instance.id] = 0;
      entry.data = undefined;
    }
    this.#bundleEntryCount = 0;
  }

  /**
   * Resolve, validate, and stage a user-provided bundle before mutation.
   * @returns Active staged entry count in {@link #bundleEntries}
   */
  #preflightBundle(bundle: readonly ComponentBundleEntryInput[]): number {
    if (!Array.isArray(bundle)) {
      throw new TypeError("Bundle must be an array of [component] or [component, data] tuples.");
    }
    for (let i = 0; i < bundle.length; i++) {
      const entry = bundle[i];
      if (!Array.isArray(entry) || (entry.length !== 1 && entry.length !== 2)) {
        this.#clearBundleEntries();
        throw new TypeError("Bundle entries must be [component] or [component, data] tuples.");
      }

      const instance = this.#componentManager.getInstance(entry[0]);
      if (instance === undefined) {
        this.#clearBundleEntries();
        throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(entry[0])));
      }

      if (this.#bundleSeenComponents[instance.id] === 1) {
        this.#clearBundleEntries();
        throw new RangeError(`Duplicate component "${instance.type.name}" in bundle.`);
      }

      let data: Partial<Record<string, number>> | undefined;
      if (entry.length === 2) {
        try {
          this.validateComponentData(instance, entry[1]);
        } catch (error) {
          this.#clearBundleEntries();
          throw error;
        }
        data = entry[1] as Partial<Record<string, number>> | undefined;
      }

      this.#bundleSeenComponents[instance.id] = 1;
      const staged = this.#bundleEntries[i];
      if (staged === undefined) {
        this.#bundleEntries[i] = { instance, data };
      } else {
        staged.instance = instance;
        staged.data = data;
      }
      this.#bundleEntryCount = i + 1;
    }
    return this.#bundleEntryCount;
  }

  /** Commit a staged bundle after all payload and capacity checks pass. */
  #commitBundleToEntity(entity: Entity, count: number): void {
    const addedCount = this.#componentManager.addBundleToEntity(
      this.#bundleEntries,
      entity,
      count,
      this.#bundleAdded,
    );
    if (addedCount > 0) {
      this.#archetypeManager.addComponentSet(entity, this.#bundleAdded, addedCount);
    }
    this.invalidateCommittedTransition(addedCount > 0);
  }

  /**
   * Roll back a newly-created entity after an unexpected bundle commit failure.
   * Strips every staged bundle component rather than walking the entity's archetype, which is unassigned when
   * the component commit itself throws partway (ownership and sparse rows may already be committed).
   * Must run before {@link #clearBundleEntries}.
   */
  #rollbackCreatedEntity(entity: Entity, count: number): void {
    let changed = this.#archetypeManager.getEntityArchetype(entity) !== undefined;
    for (let i = 0; i < count; i++) {
      if (this.#componentManager.removeInstanceFromEntity(this.#bundleEntries[i]!.instance, entity)) changed = true;
    }
    this.#archetypeManager.destroyEntity(entity);
    if (this.#entityManager.isActive(entity)) {
      this.#entityManager.destroy(entity);
      this.#notifyEntityLifecycle();
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
