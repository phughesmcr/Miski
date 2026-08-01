import { BooleanArray } from "@phughesmcr/booleanarray";

import { VERSION } from "@/constants.ts";
import { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import { type ComponentBundleCommitEntry, ComponentManager } from "@/component/component-manager.ts";
import { createEntityArray, type EntityArray, entityIndex } from "@/entity/entity.ts";
import { EntityManager } from "@/entity/entity-manager.ts";
import {
  CapacityError,
  ComponentDataError,
  componentDisplayName,
  ComponentOwnershipError,
  EntityNotFoundError,
  formatComponentNotRegistered,
  formatEntityNotActive,
  NotRegisteredError,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
import { QueryManager } from "@/query/query-manager.ts";
import { SystemManager } from "@/system/system-manager.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Query } from "@/query/query.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { Entity } from "@/entity/entity.ts";
import type { QueryEntityList } from "@/entity/entity.ts";
import type { ComponentData, SchemaOrNull, SchemaValues } from "@/types/partitions.ts";
import type {
  ComponentBundle,
  ComponentBundleEntryInput,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types/world-api.ts";
import { assertWorldState, isValidWorldSpec } from "./utils.ts";
import {
  applyComponentCheckpoint,
  captureComponentCheckpoint,
  type CheckpointEntitySet,
  type ComponentCheckpoint,
} from "@/checkpoint/checkpoint.ts";
import {
  captureRollbackState,
  commitRollbackState,
  restoreRollbackState,
  validateRollbackState,
} from "@/rollback/rollback.ts";
import type { ComponentManagerSnapshot } from "@/component/component-manager.ts";

type WorldRollbackState = {
  readonly entityJson: string;
  readonly componentSnapshot: ComponentManagerSnapshot;
  readonly revision: number;
};

type ComponentReference<
  TValue extends SchemaOrNull,
  TStorage extends SchemaOrNull = TValue,
> = Component<TValue, TStorage> | string;

type ComponentDataInput<TValue extends SchemaOrNull> = Partial<Record<keyof TValue, number>>;

/** The World is the central context in which all Entities and Components exist. */
export class World {
  /** Miski library version */
  static readonly version: string = VERSION;

  readonly #archetypeManager: ArchetypeManager;

  readonly #componentManager: ComponentManager;

  #entityManager: EntityManager;

  readonly #queryManager: QueryManager;

  readonly #systemManager: SystemManager;

  /** Monotonic world revision for query/component change tokens */
  #revision = 0;

  /** Active rollback shell, if any */
  #rollbackState: WorldRollbackState | undefined;

  /** Cache of entities visited by archetype query helpers */
  readonly #visitedArchetypeEntities: BooleanArray;

  /** Dense scratch storage for preflighted batch component transitions */
  readonly #batchEntities: EntityArray;

  /** Duplicate-detection scratch flags for preflighted batch component transitions */
  readonly #batchSeen: Uint8Array;

  /** Reusable preflighted bundle entries */
  readonly #bundleEntries: ComponentBundleCommitEntry[];

  /** Duplicate-detection scratch flags for bundle component instances */
  readonly #bundleSeenComponents: Uint8Array;

  /** The World's current state */
  #state: WorldState;

  /** The promise that resolves when the World is ready */
  readonly #initPromise: Promise<WorldState>;

  /** Resolver for the init promise */
  #initResolver?: (value: WorldState) => void;

  /** Archetype Management API */
  readonly archetypes: WorldArchetypeAPI;

  /** Entity Management API */
  readonly entities: WorldEntityAPI;

  /** Component Management API */
  readonly components: WorldComponentAPI;

  /** System Management API */
  readonly systems: WorldSystemAPI;

  #constructAPIs(): WorldAPIResult {
    return {
      archetypes: this.#constructArchetypeAPI(),
      components: this.#constructComponentAPI(),
      entities: this.#constructEntityAPI(),
      systems: this.#constructSystemAPI(),
    };
  }

  #constructArchetypeAPI(): WorldArchetypeAPI {
    return {
      getEntityArchetype: (entity: Entity) => this.#archetypeManager.getEntityArchetype(entity)?.id,
      isEntityInRoot: (entity: Entity) => this.#archetypeManager.isEntityInRoot(entity),
      queryComponents: (query: Query) => {
        this.#assertInitialized();
        return this.#queryManager.components(query);
      },
      queryEntities: (query: Query) => {
        this.#assertInitialized();
        return this.#queryArchetypeEntities(query);
      },
      queryEntered: (query: Query) => {
        this.#assertInitialized();
        return this.#queryArchetypeEntered(query);
      },
      queryExited: (query: Query) => {
        this.#assertInitialized();
        return this.#queryArchetypeExited(query);
      },
    };
  }

  #constructComponentAPI(): WorldComponentAPI {
    return {
      count: this.#componentManager.count,
      registry: this.#componentManager.registry,
      addToEntity: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
        data?: Partial<SchemaValues<TValue>> | undefined,
      ) => {
        this.#assertInitialized();
        // SchemaValues<T> values are always numeric; storage internals speak plain numbers.
        this.#addComponentToEntity(component, entity, data as ComponentDataInput<TValue> | undefined);
      },
      addToEntities: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entities: QueryEntityList,
        data?: Partial<SchemaValues<TValue>> | undefined,
      ) => {
        this.#assertInitialized();
        return this.#addComponentToEntities(
          component,
          entities,
          data as ComponentDataInput<TValue> | undefined,
        );
      },
      addBundle: <const TBundle extends readonly ComponentBundleEntryInput[]>(
        entity: Entity,
        bundle: TBundle & ComponentBundle<TBundle>,
      ) => {
        this.#assertInitialized();
        this.#addBundleToEntity(entity, bundle);
      },
      entityHas: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
      ) => this.#componentManager.entityHas(component, entity),
      getChanged: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
      ) => this.#componentManager.getChanged(component),
      getChangedSnapshot: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
      ) => this.#snapshotIterator(this.#componentManager.getChanged(component)),
      getEntityData: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
      ) => this.#getComponentEntityData(component, entity),
      readEntityData: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
      ) => this.#readComponentEntityData(component, entity),
      readEntityDataInto: <
        TValue extends SchemaOrNull,
        TStorage extends SchemaOrNull = TValue,
      >(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
        out: Partial<ComponentData<TValue>>,
      ) => this.#readComponentEntityDataInto(component, entity, out),
      getInstance: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
      ) => this.#componentManager.getInstance(component),
      require: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
      ) => this.#componentManager.require(component),
      getInstances: (array: DynamicComponent[] | Readonly<DynamicComponent[]>) =>
        this.#componentManager.getInstances(array),
      getOwners: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
      ) => this.#componentManager.getOwners(component),
      getOwnersSnapshot: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
      ) => this.#snapshotIterator(this.#componentManager.getOwners(component)),
      isRegistered: (component: DynamicComponent | string) => this.#componentManager.isRegistered(component),
      markChanged: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
      ) => {
        this.#assertInitialized();
        this.#markComponentChanged(component, entity);
      },
      query: (query: Query) => {
        this.#assertInitialized();
        return this.#queryManager.components(query);
      },
      removeFromEntity: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
      ) => {
        this.#assertInitialized();
        this.#removeComponentFromEntity(component, entity);
      },
      removeFromEntities: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entities: QueryEntityList,
      ) => {
        this.#assertInitialized();
        return this.#removeComponentFromEntities(component, entities);
      },
      setEntityData: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
        component: ComponentReference<TValue, TStorage>,
        entity: Entity,
        value: Partial<SchemaValues<TValue>>,
      ) => {
        this.#assertInitialized();
        // SchemaValues<T> values are always numeric; storage internals speak plain numbers.
        this.#setComponentEntityData(component, entity, value as ComponentDataInput<TValue>);
      },
    };
  }

  #constructEntityAPI(): WorldEntityAPI {
    return {
      capacity: this.#entityManager.capacity,
      create: () => {
        this.#assertInitialized();
        return this.#createEntity();
      },
      createWith: <const TBundle extends readonly ComponentBundleEntryInput[]>(
        bundle: TBundle & ComponentBundle<TBundle>,
      ) => {
        this.#assertInitialized();
        return this.#createEntityWithBundle(bundle, false);
      },
      createOrThrow: () => {
        this.#assertInitialized();
        const entity = this.#createEntity();
        if (entity === undefined) {
          throw new CapacityError(`World is at capacity (${this.#entityManager.capacity} entities).`);
        }
        return entity;
      },
      createWithOrThrow: <const TBundle extends readonly ComponentBundleEntryInput[]>(
        bundle: TBundle & ComponentBundle<TBundle>,
      ) => {
        this.#assertInitialized();
        return this.#createEntityWithBundle(bundle, true)!;
      },
      destroy: (entity: Entity) => {
        this.#assertInitialized();
        this.#destroyEntity(entity);
      },
      getActive: (startEntity?: Entity, endEntity?: Entity) => this.#entityManager.getActive(startEntity, endEntity),
      getActiveSnapshot: (startEntity?: Entity, endEntity?: Entity) =>
        this.#snapshotIterator(this.#entityManager.getActive(startEntity, endEntity)) ?? [],
      getActiveCount: () => this.#entityManager.getActiveCount(),
      getAvailableCount: () => this.#entityManager.getAvailableCount(),
      isActive: (entity: Entity) => this.#entityManager.isActive(entity),
      isEntity: (entity: Entity) => this.#entityManager.isEntity(entity),
      query: (query: Query) => {
        this.#assertInitialized();
        return this.#queryManager.entities(query);
      },
      queryList: (query: Query) => {
        this.#assertInitialized();
        return this.#queryManager.entityList(query);
      },
      querySnapshot: (query: Query) => {
        this.#assertInitialized();
        return this.#copyEntityList(this.#queryManager.entityList(query));
      },
      toArray: (list: QueryEntityList) => this.#copyEntityList(list),
    };
  }

  #constructSystemAPI(): WorldSystemAPI {
    const systemManager = this.#systemManager;
    return {
      get registry() {
        return systemManager.registry;
      },
      create: (system) => {
        this.#assertSystemRegistrationAvailable();
        return this.#systemManager.create(system);
      },
      get: ((system: string) => this.#systemManager.get(system)) as WorldSystemAPI["get"],
      has: (system) => this.#systemManager.has(system),
      destroy: (system) => {
        this.#assertSystemRegistrationAvailable();
        return this.#systemManager.destroy(system);
      },
    };
  }

  #assertInitialized(): void {
    assertWorldState("initialized", this.#state);
  }

  #assertSystemRegistrationAvailable(): void {
    if (this.#state === "uninitialized" || this.#state === "initialized") return;
    assertWorldState("initialized", this.#state);
  }

  #enterErrorState(): void {
    this.#state = "error";
  }

  #copyEntityList(list: QueryEntityList): Entity[] {
    const result = new Array<Entity>(list.count);
    for (let i = 0; i < list.count; i++) {
      result[i] = list.entities[i]!;
    }
    return result;
  }

  #snapshotIterator(iterator: IterableIterator<Entity> | undefined): Entity[] | undefined {
    if (iterator === undefined) return undefined;
    const result: Entity[] = [];
    for (const entity of iterator) {
      result.push(entity);
    }
    return result;
  }

  *#queryArchetypeEntities(query: Query): IterableIterator<Entity> {
    yield* this.#queryArchetypeMembership(query, "entities");
  }

  *#queryArchetypeEntered(query: Query): IterableIterator<Entity> {
    yield* this.#queryArchetypeMembership(query, "entered");
  }

  *#queryArchetypeExited(query: Query): IterableIterator<Entity> {
    yield* this.#queryArchetypeMembership(query, "exited");
  }

  /**
   * Iterate query membership with cross-archetype deduplication.
   * @param query - The query to resolve
   * @param mode - Which archetype entity stream to walk
   */
  *#queryArchetypeMembership(
    query: Query,
    mode: "entities" | "entered" | "exited",
  ): IterableIterator<Entity> {
    this.#visitedArchetypeEntities.clear();
    const queryInstance = this.#queryManager.instanceWithMembership(query);
    const archetypes = this.#archetypeManager.query(queryInstance);
    if (archetypes === undefined) {
      return;
    }
    for (const archetype of archetypes) {
      const entities = mode === "entities" ?
        archetype.getEntities() :
        mode === "entered" ?
        archetype.getEntered() :
        archetype.getExited();
      for (const entity of entities) {
        if (this.#visitedArchetypeEntities.get(entityIndex(entity))) continue;
        if (
          mode === "exited" && this.#archetypeManager.getEntityArchetype(entity)?.isCandidate(queryInstance)
        ) {
          continue;
        }
        this.#visitedArchetypeEntities.set(entityIndex(entity), true);
        yield entity;
      }
    }
    this.#visitedArchetypeEntities.clear();
  }

  /** Resolve a registered component instance for mutation paths. */
  #getRegisteredComponentInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: ComponentReference<TValue, TStorage>): ComponentInstance<TValue, TStorage> {
    const instance = this.#componentManager.getInstance(component);
    if (instance !== undefined) return instance as ComponentInstance<TValue, TStorage>;
    throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component)));
  }

  /** Validate a public component data payload before any ownership/storage mutation. */
  #validateComponentData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
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

    const partitions = instance.storage.partitions as Record<string, unknown>;
    const values = data as Record<string, unknown>;
    for (const key in values) {
      if (!hasOwnProperty(values, key)) continue;
      if (!hasOwnProperty(partitions, key)) {
        throw new ComponentDataError(`Component ${instance.type.name} does not define data field "${key}".`);
      }
      const value = values[key];
      if (value === undefined) {
        throw new ComponentDataError(`Component ${instance.type.name} data field "${key}" cannot be undefined.`);
      }
      if (typeof value !== "number") {
        throw new ComponentDataError(`Component ${instance.type.name} data field "${key}" must be a number.`);
      }
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
      const slot = entityIndex(entity);
      if (this.#batchSeen[slot] === 1) {
        this.#clearBatchEntities(i);
        throw new RangeError(`Duplicate entity ${entity} in batch entity list.`);
      }
      this.#batchSeen[slot] = 1;
      this.#batchEntities[i] = entity;
    }

    return count;
  }

  /** Clear duplicate-detection scratch flags after batch preflight/commit. */
  #clearBatchEntities(count: number): void {
    for (let i = 0; i < count; i++) {
      const entity = this.#batchEntities[i]!;
      this.#batchSeen[entityIndex(entity as Entity)] = 0;
      this.#batchEntities[i] = 0;
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
        const instance = this.#getRegisteredComponentInstance(entry[0]);
        if (this.#bundleSeenComponents[instance.id] === 1) {
          throw new RangeError(`Duplicate component "${instance.type.name}" in bundle.`);
        }
        this.#bundleSeenComponents[instance.id] = 1;

        let data: Partial<Record<string, number>> | undefined;
        if (entry.length === 2) {
          this.#validateComponentData(instance, entry[1]);
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

  /** Add a preflighted component bundle to an active entity. */
  #addBundleToEntity(entity: Entity, bundle: readonly ComponentBundleEntryInput[]): void {
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
      this.#invalidateCommittedTransition(added.length > 0);
    } finally {
      this.#clearBundleEntries();
    }
  }

  /** Roll back a newly-created entity after bundle preflight fails. */
  #rollbackCreatedEntity(entity: Entity): void {
    let changed = this.#archetypeManager.getEntityArchetype(entity) !== undefined;
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
    if (archetype) {
      for (const componentInstance of archetype.components) {
        changed ||= this.#componentManager.removeInstanceFromEntity(componentInstance, entity);
      }
    }
    this.#archetypeManager.destroyEntity(entity);
    if (this.#entityManager.isActive(entity)) {
      this.#entityManager.destroy(entity);
    }
    this.#invalidateCommittedTransition(changed);
  }

  /** Create an active entity and attach it to the root archetype. */
  #createEntity(): Entity | undefined {
    const entity = this.#entityManager.create();
    if (entity === undefined) return undefined;
    this.#archetypeManager.createEntity(entity);
    this.#invalidateCommittedTransition(true);
    return entity;
  }

  /** Create an entity and atomically attach a bundle. */
  #createEntityWithBundle(
    bundle: readonly ComponentBundleEntryInput[],
    throwOnCapacity: boolean,
  ): Entity | undefined {
    const entity = this.#createEntity();
    if (entity === undefined) {
      if (throwOnCapacity) {
        throw new CapacityError(`World is at capacity (${this.#entityManager.capacity} entities).`);
      }
      return undefined;
    }

    try {
      this.#addBundleToEntity(entity, bundle);
      return entity;
    } catch (error) {
      this.#rollbackCreatedEntity(entity);
      throw error;
    }
  }

  /** Commit an already preflighted component add. */
  #commitAddComponent<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    instance: ComponentInstance<TValue, TStorage>,
    entity: Entity,
    data?: ComponentDataInput<TValue>,
  ): boolean {
    const changed = this.#componentManager.addInstanceToEntity(instance, entity, data);
    if (changed) {
      this.#archetypeManager.addComponent(entity, instance);
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
    const changed = this.#componentManager.removeInstanceFromEntity(instance, entity);
    if (changed) {
      this.#archetypeManager.removeComponent(entity, instance);
    }
    return changed;
  }

  /** Invalidate entity query caches once for a committed ownership transition batch. */
  #invalidateCommittedTransition(changed: boolean): void {
    if (changed && this.#state === "initialized" && !this.#queryManager.cacheInvalidated) {
      this.#queryManager.invalidate();
    }
  }

  /** Add a component to an entity */
  #addComponentToEntity<
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
    const instance = this.#getRegisteredComponentInstance(component);
    this.#validateComponentData(instance, data);
    const changed = this.#commitAddComponent(instance, entity, data);
    this.#invalidateCommittedTransition(changed);
  }

  /** Add a component to every entity in a dense query list. */
  #addComponentToEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entities: QueryEntityList,
    data?: ComponentDataInput<TValue> | undefined,
  ): number {
    const instance = this.#getRegisteredComponentInstance(component);
    this.#validateComponentData(instance, data);
    const count = this.#preflightBatchEntities(entities);

    try {
      this.#componentManager.preflightAddInstanceToEntities(instance, this.#batchEntities, count);
      let changedCount = 0;
      for (let i = 0; i < count; i++) {
        if (this.#componentManager.addInstanceToEntity(instance, this.#batchEntities[i]!, data)) {
          changedCount++;
        }
      }
      if (changedCount > 0) {
        this.#archetypeManager.addComponents(this.#batchEntities, count, instance);
      }
      this.#invalidateCommittedTransition(changedCount > 0);
      return changedCount;
    } finally {
      this.#clearBatchEntities(count);
    }
  }

  /** Remove a component from an entity */
  #removeComponentFromEntity<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const changed = this.#commitRemoveComponent(this.#getRegisteredComponentInstance(component), entity);
    this.#invalidateCommittedTransition(changed);
  }

  /** Remove a component from every entity in a dense query list. */
  #removeComponentFromEntities<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entities: QueryEntityList,
  ): number {
    const instance = this.#getRegisteredComponentInstance(component);
    const count = this.#preflightBatchEntities(entities);

    try {
      let changedCount = 0;
      for (let i = 0; i < count; i++) {
        if (this.#componentManager.removeInstanceFromEntity(instance, this.#batchEntities[i]!)) {
          changedCount++;
        }
      }
      if (changedCount > 0) {
        this.#archetypeManager.removeComponents(this.#batchEntities, count, instance);
      }
      this.#invalidateCommittedTransition(changedCount > 0);
      return changedCount;
    } finally {
      this.#clearBatchEntities(count);
    }
  }

  /** Resolve a registered data component instance for guarded public data access. */
  #getGuardedDataComponent<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): ComponentInstance<TValue, TStorage> {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const instance = this.#componentManager.getInstance(component);
    if (instance === undefined) {
      throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component)));
    }
    if (instance.storage === null) {
      throw new ComponentDataError(`Component ${instance.type.name} has no data storage.`);
    }
    if (!this.#componentManager.entityOwnsInstance(instance, entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${instance.type.name}.`);
    }
    return instance as ComponentInstance<TValue, TStorage>;
  }

  /** Get guarded component data for an active owning entity. */
  #getComponentEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): ComponentData<TValue> {
    return this.#componentManager.getInstanceEntityData(this.#getGuardedDataComponent(component, entity), entity)!;
  }

  /** Set guarded component data for an active owning entity. */
  #setComponentEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
    value: ComponentDataInput<TValue>,
  ): void {
    const instance = this.#getGuardedDataComponent(component, entity);
    this.#validateComponentData(instance, value);
    this.#componentManager.setInstanceEntityData(instance, entity, value);
  }

  /** Mark guarded component data changed for an active owning entity. */
  #markComponentChanged<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): void {
    const instance = this.#getGuardedDataComponent(component, entity);
    if (!this.#componentManager.markInstanceChanged(instance, entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${instance.type.name}.`);
    }
  }

  /**
   * Read component data for an entity without throwing.
   * @returns the component data, or `undefined` if the entity is inactive, does not own the component,
   * or the component is a tag component with no data storage
   * @throws {NotRegisteredError} - If the component is not registered
   */
  #readComponentEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): ComponentData<TValue> | undefined {
    const instance = this.#getRegisteredComponentInstance(component);
    if (instance.storage === null) return undefined;
    if (!this.#entityManager.isActive(entity)) return undefined;
    if (!this.#componentManager.entityOwnsInstance(instance, entity)) return undefined;
    return this.#componentManager.getInstanceEntityData(instance, entity);
  }

  /**
   * Read component data for an entity into a caller-owned object without throwing for absence.
   * @returns `true` when data was written, otherwise `false`
   * @throws {NotRegisteredError} - If the component is not registered
   */
  #readComponentEntityDataInto<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
    out: Partial<ComponentData<TValue>>,
  ): boolean {
    const instance = this.#getRegisteredComponentInstance(component);
    if (instance.storage === null) return false;
    if (!this.#entityManager.isActive(entity)) return false;
    return this.#componentManager.getInstanceEntityDataInto(instance, entity, out);
  }

  /** Destroy an entity and clean up its components and archetype */
  #destroyEntity(entity: Entity): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
    if (archetype) {
      for (const componentInstance of archetype.components) {
        this.#componentManager.removeInstanceFromEntity(componentInstance, entity);
      }
    }
    this.#archetypeManager.destroyEntity(entity);
    this.#entityManager.destroy(entity);
    this.#invalidateCommittedTransition(true);
  }

  /**
   * Create a new World
   * @param spec - The specification to create the World with
   * @throws {SpecError} - If the provided spec object is invalid
   */
  constructor(spec: WorldSpec) {
    if (isValidWorldSpec(spec) === false) {
      throw new SpecError("Invalid WorldSpec");
    }

    this.#state = "uninitialized";
    this.#initPromise = new Promise((resolve) => {
      this.#initResolver = resolve;
    });

    // Internal managers
    const { capacity, components } = spec;
    this.#entityManager = new EntityManager(capacity);
    this.#componentManager = new ComponentManager(capacity, components, () => ++this.#revision);

    this.#archetypeManager = new ArchetypeManager(capacity, components.length);
    this.#visitedArchetypeEntities = new BooleanArray(capacity);
    this.#batchEntities = createEntityArray(capacity);
    this.#batchSeen = new Uint8Array(capacity);
    this.#bundleEntries = [];
    this.#bundleSeenComponents = new Uint8Array(components.length);

    this.#queryManager = new QueryManager(
      {
        getInstances: (array: DynamicComponent[] | Readonly<DynamicComponent[]>) =>
          this.#componentManager.getInstances(array),
        componentCount: this.#componentManager.count,
        isInitialized: () => this.#state === "initialized",
      },
      capacity,
      (queries) => {
        this.#archetypeManager.ensureQueryMembership(queries, true);
      },
      (query) => {
        this.#archetypeManager.registerQuery(query, true);
      },
    );
    this.#systemManager = new SystemManager(
      this,
      {
        queryComponents: (query: Query) => this.#queryManager.components(query),
        queryEntityList: (query: Query) => {
          this.#assertInitialized();
          return this.#queryManager.entityList(query);
        },
      },
      () => {
        if (this.#state === "initialized") this.#enterErrorState();
      },
    );

    // Public APIs
    const APIs: WorldAPIResult = this.#constructAPIs();
    this.archetypes = APIs.archetypes;
    this.components = APIs.components;
    this.entities = APIs.entities;
    this.systems = APIs.systems;
  }

  /** The World's current state */
  get state(): WorldState {
    return this.#state;
  }

  /**
   * Initialize the World
   * @throws {WorldStateError} - If the World is already initialized, or has already been destroyed
   */
  async init(): Promise<void> {
    assertWorldState("uninitialized", this.#state);
    try {
      this.#archetypeManager.init();
      this.#state = "initialized";
      await this.#systemManager.init();
      this.#initResolver?.("initialized");
      this.refresh();
      assertWorldState("initialized", this.#state);
    } catch (error) {
      this.#enterErrorState();
      this.#initResolver?.("error");
      throw error;
    }
  }

  /**
   * Destroy the World
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed
   */
  async destroy(): Promise<void> {
    assertWorldState("initialized", this.#state);
    try {
      await this.#systemManager.destroyAll();
      this.#state = "destroyed";
    } catch (error) {
      this.#enterErrorState();
      throw error;
    }
  }

  /**
   * Wait for the World to be ready
   * @throws {WorldStateError} - If the World has already been destroyed or has encountered an error
   */
  async onReady(): Promise<void> {
    const state = await this.#initPromise;
    if (state !== "initialized") {
      throw new WorldStateError(`World failed to initialize: state is "${state}"`);
    }
    if (this.#state !== "initialized") {
      throw new WorldStateError(`World is not ready: state is "${this.#state}"`);
    }
  }

  /**
   * Run routine maintenance on the World
   * @param retainChanged - skip component refresh if true
   * @param retainTransitions - skip clearing query entered/exited state if true
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed
   */
  refresh(retainChanged: boolean = false, retainTransitions: boolean = false): void {
    assertWorldState("initialized", this.#state);
    try {
      this.#archetypeManager.refresh(this.#queryManager.instancesByID.values(), retainTransitions);
      if (!retainChanged) this.#componentManager.refresh();
    } catch (error) {
      this.#enterErrorState();
      throw error;
    }
  }

  /**
   * Run one simulation tick, then {@link refresh} enter/exit transition sets.
   * Consume entered/exited/changed inside `fn` before it completes.
   */
  frame<T>(fn: () => T): T {
    this.#assertInitialized();
    try {
      return fn();
    } finally {
      this.refresh();
    }
  }

  /**
   * Monotonic revision token for a query's relevant component types.
   * Unrelated component writes leave this value unchanged.
   */
  queryRevision(query: Query): number {
    const components = [
      ...query.all,
      ...query.any,
      ...query.include,
    ];
    if (components.length === 0) return this.#revision;
    return this.#componentManager.latestChangedRevision(components);
  }

  /** Capture membership and values for selected components across an entity set. */
  captureCheckpoint(entitySet: CheckpointEntitySet, ...components: DynamicComponent[]): ComponentCheckpoint {
    this.#assertInitialized();
    return captureComponentCheckpoint(this, entitySet, components);
  }

  /** Restore a component-subset checkpoint captured from this world. */
  applyCheckpoint(checkpoint: ComponentCheckpoint): void {
    this.#assertInitialized();
    applyComponentCheckpoint(this, checkpoint);
  }

  /** @internal CheckpointWorld */
  isEntityAlive(entity: Entity): boolean {
    return this.#entityManager.isActive(entity);
  }

  /** @internal CheckpointWorld */
  entityHasComponent(entity: Entity, component: DynamicComponent): boolean {
    return this.#componentManager.entityHas(component, entity);
  }

  /** @internal CheckpointWorld */
  getComponentInstance(component: DynamicComponent): ComponentInstance<SchemaOrNull, SchemaOrNull> {
    return this.#componentManager.require(component);
  }

  /** @internal CheckpointWorld */
  addComponentToEntity(
    entity: Entity,
    component: DynamicComponent,
    properties: Record<string, number>,
  ): void {
    this.#addComponentToEntity(component, entity, properties);
  }

  /** @internal CheckpointWorld */
  removeComponentFromEntity(entity: Entity, component: DynamicComponent): void {
    this.#removeComponentFromEntity(component, entity);
  }

  /** @internal */
  [captureRollbackState](): WorldRollbackState {
    if (this.#rollbackState !== undefined) throw new Error("A world rollback scope is already active.");
    const state: WorldRollbackState = {
      entityJson: this.#entityManager.stringify(),
      componentSnapshot: this.#componentManager.captureSnapshot(),
      revision: this.#revision,
    };
    this.#rollbackState = state;
    return state;
  }

  /** @internal */
  [validateRollbackState](state: WorldRollbackState): void {
    if (this.#rollbackState !== state) throw new TypeError("Invalid world rollback state.");
  }

  /** @internal */
  [commitRollbackState](state: WorldRollbackState): void {
    this[validateRollbackState](state);
    this.#rollbackState = undefined;
  }

  /** @internal */
  [restoreRollbackState](state: WorldRollbackState): void {
    this[validateRollbackState](state);
    this.#rollbackState = undefined;
    this.#entityManager = EntityManager.fromJSON(state.entityJson);
    this.#componentManager.restoreSnapshot(state.componentSnapshot);
    this.#archetypeManager.rebuildFromOwnership(
      this.#entityManager.getActive(),
      (entity) => this.#componentManager.getEntityComponents(entity),
    );
    this.#queryManager.invalidate();
    this.#revision = state.revision + 1;
  }
}

export { captureWorldRollbackPoint, commitWorldRollbackPoint, restoreWorldRollbackPoint } from "@/rollback/rollback.ts";
