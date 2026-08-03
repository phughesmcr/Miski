import { BooleanArray } from "@phughesmcr/booleanarray";

import { VERSION } from "@/constants.ts";
import { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import { ComponentManager, type ComponentManagerSnapshot } from "@/component/component-manager.ts";
import { EntityManager } from "@/entity/entity-manager.ts";
import { type Entity, entityIndex, type QueryEntityList } from "@/entity/entity.ts";
import {
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
import { constructWorldAPIs } from "./world-api-facade.ts";
import { assertWorldState, isValidWorldSpec } from "./utils.ts";
import { WorldMutations } from "./world-mutations.ts";

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

  readonly #mutations: WorldMutations;

  readonly #queryManager: QueryManager;

  readonly #systemManager: SystemManager;

  /** Monotonic world revision for query/component change tokens */
  #revision = 0;

  /** Active rollback shell, if any */
  #rollbackState: WorldRollbackState | undefined;

  /** Cache of entities visited by archetype query helpers */
  readonly #visitedArchetypeEntities: BooleanArray;

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
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
    if (archetype) {
      for (const componentInstance of archetype.components) {
        this.#componentManager.removeInstanceFromEntity(componentInstance, entity);
      }
    }
    this.#archetypeManager.destroyEntity(entity);
    this.#entityManager.destroy(entity);
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
    this.#componentManager = new ComponentManager(capacity, components, () => ++this.#revision, packSlot);

    this.#archetypeManager = new ArchetypeManager(capacity, components.length, packSlot);
    this.#visitedArchetypeEntities = new BooleanArray(capacity);

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
    this.#mutations = new WorldMutations({
      entityManager: this.#entityManager,
      componentManager: this.#componentManager,
      archetypeManager: this.#archetypeManager,
      capacity,
      componentCount: components.length,
      isInitialized: () => this.#state === "initialized",
      invalidateQueries: () => {
        if (!this.#queryManager.cacheInvalidated) {
          this.#queryManager.invalidate();
        }
      },
    });
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
    const APIs: WorldAPIResult = constructWorldAPIs({
      assertInitialized: () => this.#assertInitialized(),
      assertSystemRegistrationAvailable: () => this.#assertSystemRegistrationAvailable(),
      archetypeManager: this.#archetypeManager,
      componentManager: this.#componentManager,
      entityManager: this.#entityManager,
      queryManager: this.#queryManager,
      systemManager: this.#systemManager,
      mutations: this.#mutations,
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
    this.#mutations.addComponentToEntity(component, entity, properties);
  }

  /** @internal CheckpointWorld */
  removeComponentFromEntity(entity: Entity, component: DynamicComponent): void {
    this.#mutations.removeComponentFromEntity(component, entity);
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
    this.#mutations.replaceEntityManager(this.#entityManager);
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
