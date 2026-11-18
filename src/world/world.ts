import { VERSION } from "@/constants.ts";
import { ArchetypeManager, type ArchetypeManagerSnapshot } from "@/archetype/archetype-manager.ts";
import { ComponentManager, type ComponentManagerSnapshot } from "@/component/component-manager.ts";
import { EntityManager, type EntityManagerState } from "@/entity/entity-manager.ts";
import { asEntity, type Entity, type QueryEntityList } from "@/entity/entity.ts";
import {
  ComponentDataError,
  ComponentOwnershipError,
  EntityNotFoundError,
  formatEntityNotActive,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
import { ArchetypeQueryIterators } from "@/query/query-iterators.ts";
import { QueryManager } from "@/query/query-manager.ts";
import { RelationManager, type RelationManagerSnapshot } from "@/relation/relation-manager.ts";
import { isInHookScope } from "@/system/hook-scope.ts";
import { SystemManager } from "@/system/system-manager.ts";
import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Query } from "@/query/query.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentData, SchemaOrNull } from "@/types/partitions.ts";
import type {
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types/world-api.ts";
import type { WorldRelationAPI } from "@/types/world-relation-api.ts";
import {
  applyComponentCheckpoint,
  captureComponentCheckpoint,
  type CheckpointEntitySet,
  type CheckpointWorld,
  type ComponentCheckpoint,
} from "@/checkpoint/checkpoint.ts";
import {
  captureRollbackState,
  commitRollbackState,
  restoreRollbackState,
  validateRollbackState,
} from "@/rollback/rollback.ts";
import { constructWorldAPIs } from "./world-api-facade.ts";
import { noop } from "@/utils.ts";
import { assertWorldState, isValidWorldSpec } from "./utils.ts";
import { WorldMutations } from "./world-mutations.ts";
import { PrefabSpawner } from "@/prefab/prefab-spawner.ts";

type WorldRollbackState = {
  readonly entities: EntityManagerState;
  readonly componentSnapshot: ComponentManagerSnapshot;
  readonly archetypes: ArchetypeManagerSnapshot;
  readonly relations: RelationManagerSnapshot | undefined;
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

  readonly #entityManager: EntityManager;

  readonly #mutations: WorldMutations;

  readonly #queryManager: QueryManager;

  /** Pooled iterators behind the archetype query views */
  readonly #archetypeQueryIterators: ArchetypeQueryIterators;

  readonly #systemManager: SystemManager;

  /** Relation pair index; `undefined` when the world registers no relations. */
  readonly #relationManager: RelationManager | undefined;

  /** Bound once so cascading destroys allocate nothing. */
  readonly #destroyEntityCore = (entity: Entity): void => this.#destroyEntityStorage(entity);

  /** Monotonic world revision for query/component change tokens */
  #revision = 0;

  #entityRevision = 0;

  readonly #checkpointHost: CheckpointWorld;

  /** Active rollback shell, if any */
  #rollbackState: WorldRollbackState | undefined;

  /** The World's current state */
  #state: WorldState;

  #initializing = false;

  #destroying = false;

  /** Settles (never rejects) when the in-flight `init()` has finished, successfully or not. */
  #initSettled: Promise<void> | undefined;

  /** Resolves when teardown begins, releasing waiters that would otherwise wait on a pending hook. */
  readonly #teardownStarted: PromiseWithResolvers<void> = Promise.withResolvers<void>();

  /** The first error that moved the world into the `error` state. */
  #failure: { readonly cause: unknown } | undefined;

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

  /** Relation API: pairs, reverse lookups, pair data and hierarchy traversal */
  readonly relations: WorldRelationAPI;

  #assertInitialized(): void {
    if (this.#state === "error") throw this.#stateError("World has encountered an error");
    assertWorldState("initialized", this.#state);
  }

  /** A state error that carries the root cause when the world is in the `error` state. */
  #stateError(message: string): Error {
    if (this.#state === "error" && this.#failure !== undefined) {
      return new WorldStateError(message, { cause: this.#failure.cause });
    }
    return new WorldStateError(message);
  }

  #assertSystemRegistrationAvailable(): void {
    if (this.#destroying && !this.#initializing) throw new WorldStateError("World is being destroyed");
    if (this.#state === "uninitialized" || this.#state === "initialized") return;
    this.#assertInitialized();
  }

  #enterErrorState(cause: unknown): void {
    this.#failure ??= { cause };
    this.#state = "error";
  }

  #assertNotInHook(operation: string): void {
    if (isInHookScope()) {
      throw new WorldStateError(
        `${operation} cannot be awaited from a system init or destroy hook: ` +
          "the world waits for the hook to finish, so the hook would wait on itself",
      );
    }
  }

  #copyEntityList(list: QueryEntityList): Entity[] {
    const result = new Array<Entity>(list.count);
    for (let i = 0; i < list.count; i++) {
      result[i] = asEntity(list.entities[i]!);
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

  /**
   * Live entities of every archetype matching the query; each entity inhabits exactly one archetype.
   * Returns a pooled iterator, so warm passes allocate nothing.
   */
  #queryArchetypeEntities(query: Query): IterableIterator<Entity> {
    return this.#archetypeQueryIterators.entities(query);
  }

  /**
   * Entities that match the query now but did not match it when the refresh window began.
   * Only slots that moved this window can qualify, so this walks the window's touched slots in first-touch order.
   */
  #queryArchetypeEntered(query: Query): IterableIterator<Entity> {
    return this.#archetypeQueryIterators.entered(query);
  }

  /**
   * Entities that matched the query when the refresh window began but do not match it now.
   * Reports the window-start handle, which may since have been destroyed.
   */
  #queryArchetypeExited(query: Query): IterableIterator<Entity> {
    return this.#archetypeQueryIterators.exited(query);
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
    const instance = this.#mutations.getRegisteredComponentInstance(component);
    if (instance.storage === null) {
      throw new ComponentDataError(`Component ${instance.type.name} has no data storage.`);
    }
    if (!this.#componentManager.entityOwnsInstance(instance, entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${instance.type.name}.`);
    }
    return instance;
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
    this.#mutations.validateComponentData(instance, value);
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
    const instance = this.#mutations.getRegisteredComponentInstance(component);
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
    const instance = this.#mutations.getRegisteredComponentInstance(component);
    if (instance.storage === null) return false;
    if (!this.#entityManager.isActive(entity)) return false;
    return this.#componentManager.getInstanceEntityDataInto(instance, entity, out);
  }

  /** Destroy an entity and clean up its components and archetype */
  #destroyEntity(entity: Entity): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    if (this.#relationManager !== undefined) {
      this.#relationManager.destroyEntity(entity, this.#destroyEntityCore);
      return;
    }
    this.#destroyEntityStorage(entity);
  }

  /** Remove an active entity's components and archetype, then release its slot. */
  #destroyEntityStorage(entity: Entity): void {
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
    if (archetype) {
      const components = archetype.components;
      for (let i = 0; i < components.length; i++) {
        this.#componentManager.removeInstanceFromEntity(components[i]!, entity);
      }
    }
    this.#archetypeManager.destroyEntity(entity);
    this.#entityManager.destroy(entity);
    this.#entityRevision = ++this.#revision;
    this.#mutations.invalidateCommittedTransition(true);
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
    const packSlot = (slot: number) => this.#entityManager.packSlot(slot);
    this.#componentManager = new ComponentManager(
      capacity,
      components,
      () => ++this.#revision,
      packSlot,
      (entity) => this.#entityManager.isActive(entity),
    );

    this.#archetypeManager = new ArchetypeManager(capacity, components.length, packSlot);

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
    this.#archetypeQueryIterators = new ArchetypeQueryIterators({
      instanceWithMembership: (query) => this.#queryManager.instanceWithMembership(query),
      transitionWindow: this.#archetypeManager.transitionWindow,
      archetypeAtSlot: (slot) => this.#archetypeManager.archetypeAtSlot(slot),
      getEntityArchetype: (entity) => this.#archetypeManager.getEntityArchetype(entity),
      packSlot,
    });
    this.#mutations = new WorldMutations({
      entityManager: this.#entityManager,
      componentManager: this.#componentManager,
      archetypeManager: this.#archetypeManager,
      capacity,
      componentCount: components.length,
      isInitialized: () => this.#state === "initialized",
      notifyEntityLifecycle: () => {
        this.#entityRevision = ++this.#revision;
      },
      // Query results track structural changes through per-archetype stamps (see QueryManager.entityList).
      invalidateQueries: () => {},
    });
    this.#systemManager = new SystemManager(
      this,
      {
        queryComponents: (query: Query) => this.#queryManager.components(query),
        queryEntityList: (query: Query) => {
          this.#assertInitialized();
          if (this.#initializing) throw new WorldStateError("World is being initialized");
          if (this.#destroying) throw new WorldStateError("World is being destroyed");
          return this.#queryManager.entityList(query);
        },
      },
      (error) => {
        if (this.#state === "initialized") this.#enterErrorState(error);
      },
    );

    const relationManager = new RelationManager({
      capacity,
      isActive: (entity) => this.#entityManager.isActive(entity),
      packSlot,
      setPresence: (instance, entity, present) => this.#mutations.setRelationPresence(instance, entity, present),
      bumpRevision: (instance) => this.#componentManager.bumpInstanceRevision(instance),
      archetypeAtSlot: (slot) => this.#archetypeManager.archetypeAtSlot(slot),
      getInstance: (component) => this.#componentManager.getInstance(component),
      registerQuery: (query) => this.#queryManager.register(query),
    }, components);
    this.#relationManager = RelationManager.hasRelations(components) ? relationManager : undefined;
    for (const instance of relationManager.instances) this.#mutations.markRelationInstance(instance.id);
    this.relations = relationManager.createAPI(() => this.#assertInitialized());

    this.#checkpointHost = {
      isEntityAlive: (entity) => this.#entityManager.isActive(entity),
      entityHasComponent: (entity, component) => this.#componentManager.entityHas(component, entity),
      getComponentInstance: (component) => this.#componentManager.require(component),
      getOwnerCount: (component) => this.#componentManager.getOwnerCount(component),
      validateComponentData: (component, properties) =>
        this.#mutations.validateComponentData(this.#componentManager.require(component), properties),
      setComponentEntityData: (entity, component, properties) =>
        this.#setComponentEntityData(component, entity, properties),
      addComponentToEntity: (entity, component, properties) =>
        this.#mutations.addComponentToEntity(component, entity, properties),
      removeComponentFromEntity: (entity, component) => this.#mutations.removeComponentFromEntity(component, entity),
      isRelation: (component) => relationManager.isRegisteredRelation(component),
      captureRelationPairs: (entity, component) => relationManager.capturePairs(entity, component),
      preflightRelationPairs: (component, entries) => relationManager.preflightPairs(component, entries),
      restoreRelationPairs: (entity, component, pairs) => relationManager.restorePairs(entity, component, pairs),
    };

    // Public APIs
    const APIs: WorldAPIResult = constructWorldAPIs({
      assertInitialized: () => this.#assertInitialized(),
      assertSystemRegistrationAvailable: () => this.#assertSystemRegistrationAvailable(),
      archetypeManager: this.#archetypeManager,
      componentManager: this.#componentManager,
      entityManager: this.#entityManager,
      queryManager: this.#queryManager,
      systemManager: this.#systemManager,
      mutations: this.#mutations,
      prefabs: new PrefabSpawner({
        entityManager: this.#entityManager,
        componentManager: this.#componentManager,
        archetypeManager: this.#archetypeManager,
        componentCount: components.length,
        notifyEntityLifecycle: () => {
          this.#entityRevision = ++this.#revision;
        },
        invalidateCommittedTransition: (changed) => this.#mutations.invalidateCommittedTransition(changed),
      }),
      getComponentEntityData: (component, entity) => this.#getComponentEntityData(component, entity),
      readComponentEntityData: (component, entity) => this.#readComponentEntityData(component, entity),
      readComponentEntityDataInto: (component, entity, out) =>
        this.#readComponentEntityDataInto(component, entity, out),
      markComponentChanged: (component, entity) => this.#markComponentChanged(component, entity),
      setComponentEntityData: (component, entity, value) => this.#setComponentEntityData(component, entity, value),
      destroyEntity: (entity) => this.#destroyEntity(entity),
      snapshotIterator: (iterator) => this.#snapshotIterator(iterator),
      copyEntityList: (list) => this.#copyEntityList(list),
      queryArchetypeEntities: (query) => this.#queryArchetypeEntities(query),
      queryArchetypeEntered: (query) => this.#queryArchetypeEntered(query),
      queryArchetypeExited: (query) => this.#queryArchetypeExited(query),
    });
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
   * Initialize the World and wait for all system init hooks and the initial refresh.
   * Hooks may mutate the world; system callbacks wait until initialization completes.
   * @throws {WorldStateError} - If the World is already initialized, or has already been destroyed
   */
  async init(): Promise<void> {
    if (this.#state === "error") throw this.#stateError("World has encountered an error");
    assertWorldState("uninitialized", this.#state);
    this.#initializing = true;
    const run = this.#runInit();
    this.#initSettled = run.then(noop, noop);
    await run;
  }

  async #runInit(): Promise<void> {
    try {
      this.#archetypeManager.init();
      this.#state = "initialized";
      await this.#systemManager.init();
      // A late hook registered by an init hook may have failed; surface its error, not a generic one.
      this.#throwFailure();
      this.refresh();
      this.#assertInitialized();
      this.#initResolver?.("initialized");
    } catch (error) {
      this.#enterErrorState(error);
      this.#initResolver?.("error");
      throw error;
    } finally {
      this.#initializing = false;
    }
  }

  /** Rethrow the root cause if the world has entered the `error` state. */
  #throwFailure(): void {
    if (this.#state === "error" && this.#failure !== undefined) throw this.#failure.cause;
  }

  /**
   * Destroy the World, awaiting any in-flight init and pending late init hooks before running every destroy hook.
   * System registration and callbacks close immediately (except for hooks still being initialized);
   * hooks may still mutate entities.
   *
   * Only systems whose init completed successfully are destroyed. Teardown also cleans up a world that
   * is in the error state (for example after a failed `init()`): it runs those destroy hooks and, if they
   * all succeed, leaves the world `destroyed`. A destroy-hook failure unregisters all systems and leaves
   * the world in the error state. Destroy hooks of an errored world see the world in the error state.
   *
   * Do not await this from a system init or destroy hook: teardown waits for the hook, so it would wait
   * on itself. Such calls are rejected where the runtime supports async context tracking.
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed,
   * or teardown is already in progress
   */
  async destroy(): Promise<void> {
    if (this.#state === "uninitialized" || this.#state === "destroyed") {
      assertWorldState("initialized", this.#state);
    }
    this.#assertNotInHook("world.destroy()");
    if (this.#destroying) throw new WorldStateError("World is being destroyed");
    this.#destroying = true;
    this.#teardownStarted.resolve();
    try {
      // `init()` always settles: a hook waiting on readiness is released by the teardown signal.
      if (this.#initializing) await this.#initSettled;
      const startedInError = this.#state === "error";
      await this.#systemManager.onReady();
      await this.#systemManager.destroyAll();
      if (this.#state === "initialized") {
        this.#state = "destroyed";
      } else if (startedInError) {
        this.#state = "destroyed";
      } else {
        this.#throwFailure();
        this.#assertInitialized();
      }
    } catch (error) {
      this.#enterErrorState(error);
      throw error;
    } finally {
      this.#destroying = false;
    }
  }

  /**
   * Wait for initial setup and all currently pending late system init hooks.
   *
   * Do not await this from a system init or destroy hook: readiness waits for the hook, so it would wait on
   * itself. Such calls are rejected where the runtime supports async context tracking, and any waiting call
   * is rejected as soon as teardown starts.
   * @throws {WorldStateError} - If the World has already been destroyed or has encountered an error;
   * the root cause of an error is available as `cause`
   */
  async onReady(): Promise<void> {
    this.#assertNotInHook("world.onReady()");
    if (this.#destroying) throw new WorldStateError("World is being destroyed");
    const state = await Promise.race([this.#initPromise, this.#teardownStarted.promise.then(() => undefined)]);
    if (state === undefined || this.#destroying) throw new WorldStateError("World is being destroyed");
    if (state !== "initialized") {
      throw this.#stateError(`World failed to initialize: state is "${state}"`);
    }
    if (this.#state !== "initialized") {
      throw this.#stateError(`World is not ready: state is "${this.#state}"`);
    }
    await Promise.race([this.#systemManager.onReady(), this.#teardownStarted.promise]);
    if (this.#destroying) throw new WorldStateError("World is being destroyed");
    if (this.#state !== "initialized") {
      throw this.#stateError(`World is not ready: state is "${this.#state}"`);
    }
  }

  /**
   * Run routine maintenance on the World
   * @param retainChanged - skip component refresh if true
   * @param retainTransitions - skip clearing query entered/exited state if true
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed
   */
  refresh(retainChanged: boolean = false, retainTransitions: boolean = false): void {
    this.#assertInitialized();
    try {
      this.#archetypeManager.refresh(this.#queryManager.registeredQueries, retainTransitions);
      if (!retainChanged) {
        this.#componentManager.refresh();
        this.#relationManager?.refresh();
      }
    } catch (error) {
      this.#enterErrorState(error);
      throw error;
    }
  }

  /**
   * Run one simulation tick, then {@link refresh} enter/exit transition sets.
   * Consume entered/exited/changed inside `fn` before it completes.
   */
  frame<T>(fn: () => T): T {
    this.#assertInitialized();
    let result: T;
    try {
      result = fn();
    } catch (error) {
      // The callback's error is the one the caller needs. Refresh only a world that can still be refreshed,
      // and never let a refresh failure replace it.
      if (this.#state === "initialized") {
        try {
          this.refresh();
        } catch {
          // refresh() already moved the world into the error state
        }
      }
      throw error;
    }
    this.refresh();
    return result;
  }

  /**
   * Monotonic revision token for a query's relevant component types.
   * Unrelated component writes leave this value unchanged.
   */
  queryRevision(query: Query): number {
    this.#assertInitialized();
    const lifecycleRevision = query.all.length === 0 && query.any.length === 0 ? this.#entityRevision : 0;
    return Math.max(lifecycleRevision, this.#componentManager.latestChangedRevision(query.dependencyComponents));
  }

  /** Capture membership and values for selected components across an entity set. */
  captureCheckpoint(entitySet: CheckpointEntitySet, ...components: DynamicComponent[]): ComponentCheckpoint {
    this.#assertInitialized();
    return captureComponentCheckpoint(this.#checkpointHost, entitySet, components);
  }

  /** Restore a component-subset checkpoint captured from this world. */
  applyCheckpoint(checkpoint: ComponentCheckpoint): void {
    this.#assertInitialized();
    applyComponentCheckpoint(this.#checkpointHost, checkpoint);
  }

  /** @internal */
  [captureRollbackState](): WorldRollbackState {
    this.#assertInitialized();
    if (this.#rollbackState !== undefined) throw new Error("A world rollback scope is already active.");
    const state: WorldRollbackState = {
      entities: this.#entityManager.captureState(),
      componentSnapshot: this.#componentManager.captureSnapshot(),
      archetypes: this.#archetypeManager.captureState(),
      relations: this.#relationManager?.captureState(),
    };
    this.#rollbackState = state;
    return state;
  }

  /** @internal */
  [validateRollbackState](state: WorldRollbackState): void {
    this.#assertInitialized();
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
    this.#entityManager.restoreState(state.entities);
    this.#componentManager.restoreSnapshot(state.componentSnapshot);
    this.#archetypeManager.restoreState(state.archetypes);
    if (state.relations !== undefined) this.#relationManager?.restoreState(state.relations);
    this.#queryManager.invalidate();
    this.#entityRevision = ++this.#revision;
  }
}

export { captureWorldRollbackPoint, commitWorldRollbackPoint, restoreWorldRollbackPoint } from "@/rollback/rollback.ts";
