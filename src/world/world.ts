/**
 * @module      World
 * @description The World is the central context in which all Entities and Components exist.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";

import { VERSION } from "@/constants.ts";
import { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import { ComponentManager } from "@/component/component-manager.ts";
import { createEntityArray, type EntityArray } from "@/entity/entity-array.ts";
import { EntityManager } from "@/entity/entity-manager.ts";
import {
  ComponentDataError,
  ComponentOwnershipError,
  EntityNotFoundError,
  NotRegisteredError,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
import { QueryManager } from "@/query/query-manager.ts";
import { SystemManager } from "@/system/system-manager.ts";
import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Query } from "@/query/query.ts";
import type {
  DynamicComponent,
  DynamicComponentInstance,
  Entity,
  QueryEntityList,
  SchemaOrNull,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types.ts";
import { assertWorldState, isValidWorldSpec } from "./utils.ts";

/** The World is the central context in which all Entities and Components exist. */
export class World {
  /** Miski library version */
  static readonly version: string = VERSION;

  /** Handles groupings of components */
  #archetypeManager: ArchetypeManager;

  /** Handles component registration and allocation */
  #componentManager: ComponentManager;

  /** Handles entity creation and destruction */
  #entityManager: EntityManager;

  /** Handles groupings of entities */
  #queryManager: QueryManager;

  /** Handles system creation and destruction */
  #systemManager: SystemManager;

  /** Cache of entities visited by archetype query helpers */
  #visitedArchetypeEntities: BooleanArray;

  /** Dense scratch storage for preflighted batch component transitions */
  #batchEntities: EntityArray;

  /** Duplicate-detection scratch flags for preflighted batch component transitions */
  #batchSeen: Uint8Array;

  /** The World's current state */
  #state: WorldState;

  /** The promise that resolves when the World is ready */
  #initPromise: Promise<WorldState>;

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

  /** Construct the public APIs for the World */
  #constructAPIs(): WorldAPIResult {
    return {
      archetypes: this.#constructArchetypeAPI(),
      components: this.#constructComponentAPI(),
      entities: this.#constructEntityAPI(),
      systems: this.#constructSystemAPI(),
    };
  }

  /** Construct the archetype public API facade */
  #constructArchetypeAPI(): WorldArchetypeAPI {
    return {
      getEntityArchetype: (entity: Entity) => this.#archetypeManager.getEntityArchetype(entity)?.id,
      isEntityInRoot: (entity: Entity) => this.#archetypeManager.isEntityInRoot(entity),
      queryComponents: (query: Query) => this.#queryArchetypeComponents(query),
      queryEntities: (query: Query) => this.#queryArchetypeEntities(query),
      queryEntered: (query: Query) => this.#queryEnteredEntities(query),
      queryExited: (query: Query) => this.#queryExitedEntities(query),
    };
  }

  /** Construct the component public API facade */
  #constructComponentAPI(): WorldComponentAPI {
    return {
      count: this.#componentManager.count,
      registry: this.#componentManager.registry,
      addToEntity: <T extends SchemaOrNull>(
        component: Component<T> | string,
        entity: Entity,
        data?: { [k in keyof T]: number } | undefined,
      ) => this.#addComponentToEntity(component, entity, data),
      addToEntities: <T extends SchemaOrNull>(
        component: Component<T> | string,
        entities: QueryEntityList,
        data?: { [k in keyof T]: number } | undefined,
      ) => this.#addComponentToEntities(component, entities, data),
      entityHas: <T extends SchemaOrNull>(component: Component<T> | string, entity: Entity) =>
        this.#componentManager.entityHas(component, entity),
      getChanged: <T extends SchemaOrNull>(component: Component<T> | string) =>
        this.#componentManager.getChanged(component),
      getChangedSnapshot: <T extends SchemaOrNull>(component: Component<T> | string) =>
        this.#snapshotIterator(this.#componentManager.getChanged(component)),
      getEntityData: <T extends SchemaOrNull>(component: Component<T> | string, entity: Entity) =>
        this.#getComponentEntityData(component, entity),
      getInstance: <T extends SchemaOrNull>(component: Component<T> | string) =>
        this.#componentManager.getInstance(component),
      getInstances: (array: DynamicComponent[]) => this.#componentManager.getInstances(array),
      getOwners: <T extends SchemaOrNull>(component: Component<T> | string) =>
        this.#componentManager.getOwners(component),
      getOwnersSnapshot: <T extends SchemaOrNull>(component: Component<T> | string) =>
        this.#snapshotIterator(this.#componentManager.getOwners(component)),
      isRegistered: (component: DynamicComponent | string) => this.#componentManager.isRegistered(component),
      query: (query: Query) => this.#queryManager.components(query),
      removeFromEntity: <T extends SchemaOrNull>(component: string | Component<T>, entity: Entity) =>
        this.#removeComponentFromEntity(component, entity),
      removeFromEntities: <T extends SchemaOrNull>(component: Component<T> | string, entities: QueryEntityList) =>
        this.#removeComponentFromEntities(component, entities),
      setEntityData: <T extends SchemaOrNull>(
        component: Component<T> | string,
        entity: Entity,
        value: Record<keyof T, number>,
      ) => this.#setComponentEntityData(component, entity, value),
    };
  }

  /** Construct the entity public API facade */
  #constructEntityAPI(): WorldEntityAPI {
    return {
      capacity: this.#entityManager.capacity,
      create: () => this.#entityManager.create(),
      destroy: (entity: Entity) => this.#destroyEntity(entity),
      getActive: (startEntity?: Entity, endEntity?: Entity) => this.#entityManager.getActive(startEntity, endEntity),
      getActiveSnapshot: (startEntity?: Entity, endEntity?: Entity) =>
        this.#snapshotIterator(this.#entityManager.getActive(startEntity, endEntity)) ?? [],
      getActiveCount: () => this.#entityManager.getActiveCount(),
      getAvailableCount: () => this.#entityManager.getAvailableCount(),
      isActive: (entity: Entity) => this.#entityManager.isActive(entity),
      isEntity: (entity: Entity) => this.#entityManager.isEntity(entity),
      query: (query: Query) => this.#queryManager.entities(query),
      queryList: (query: Query) => this.#queryManager.entityList(query),
      querySnapshot: (query: Query) => this.#copyEntityList(this.#queryManager.entityList(query)),
      toArray: (list: QueryEntityList) => this.#copyEntityList(list),
    };
  }

  /** Construct the system public API facade */
  #constructSystemAPI(): WorldSystemAPI {
    const systemManager = this.#systemManager;
    return {
      get registry() {
        return systemManager.registry;
      },
      create: (system) => this.#systemManager.create(system),
      get: (system) => this.#systemManager.get(system),
      has: (system) => this.#systemManager.has(system),
      destroy: (system) => this.#systemManager.destroy(system),
    };
  }

  /** Throw the current lifecycle state's public API error. */
  #throwUnavailable(): never {
    assertWorldState("initialized", this.#state);
    throw new WorldStateError("World is unavailable");
  }

  /** Install facades for APIs that require an initialized World. */
  #installUninitializedAPIs(): void {
    const unavailable = () => {
      throw new WorldStateError("World has not been initialized");
    };

    this.archetypes.queryComponents = unavailable;
    this.archetypes.queryEntities = unavailable;
    this.archetypes.queryEntered = unavailable;
    this.archetypes.queryExited = unavailable;

    this.components.addToEntity = unavailable;
    this.components.addToEntities = unavailable;
    this.components.query = unavailable;
    this.components.removeFromEntity = unavailable;
    this.components.removeFromEntities = unavailable;
    this.components.setEntityData = unavailable;

    this.entities.create = unavailable;
    this.entities.destroy = unavailable;
    this.entities.query = unavailable;
    this.entities.queryList = unavailable;
    this.entities.querySnapshot = unavailable;
  }

  /** Install initialized fast-path facades with no lifecycle branch in public hot methods. */
  #installInitializedAPIs(): void {
    this.archetypes.queryComponents = (query: Query) => this.#queryArchetypeComponents(query);
    this.archetypes.queryEntities = (query: Query) => this.#queryArchetypeEntities(query);
    this.archetypes.queryEntered = (query: Query) => this.#queryEnteredEntities(query);
    this.archetypes.queryExited = (query: Query) => this.#queryExitedEntities(query);

    this.components.addToEntity = <T extends SchemaOrNull>(
      component: Component<T> | string,
      entity: Entity,
      data?: { [k in keyof T]: number } | undefined,
    ) => this.#addComponentToEntity(component, entity, data);
    this.components.addToEntities = <T extends SchemaOrNull>(
      component: Component<T> | string,
      entities: QueryEntityList,
      data?: { [k in keyof T]: number } | undefined,
    ) => this.#addComponentToEntities(component, entities, data);
    this.components.query = (query: Query) => this.#queryManager.components(query);
    this.components.removeFromEntity = <T extends SchemaOrNull>(component: string | Component<T>, entity: Entity) =>
      this.#removeComponentFromEntity(component, entity);
    this.components.removeFromEntities = <T extends SchemaOrNull>(
      component: Component<T> | string,
      entities: QueryEntityList,
    ) => this.#removeComponentFromEntities(component, entities);
    this.components.setEntityData = <T extends SchemaOrNull>(
      component: Component<T> | string,
      entity: Entity,
      value: Record<keyof T, number>,
    ) => this.#setComponentEntityData(component, entity, value);

    this.entities.create = () => this.#entityManager.create();
    this.entities.destroy = (entity: Entity) => this.#destroyEntity(entity);
    this.entities.query = (query: Query) => this.#queryManager.entities(query);
    this.entities.queryList = (query: Query) => this.#queryManager.entityList(query);
    this.entities.querySnapshot = (query: Query) => this.#copyEntityList(this.#queryManager.entityList(query));

    this.systems.create = (system) => this.#systemManager.create(system);
    this.systems.destroy = (system) => this.#systemManager.destroy(system);
  }

  /** Install facades for APIs that are unavailable after destroy or error. */
  #installUnavailableAPIs(): void {
    const unavailable = () => this.#throwUnavailable();

    this.archetypes.queryComponents = unavailable;
    this.archetypes.queryEntities = unavailable;
    this.archetypes.queryEntered = unavailable;
    this.archetypes.queryExited = unavailable;

    this.components.addToEntity = unavailable;
    this.components.addToEntities = unavailable;
    this.components.query = unavailable;
    this.components.removeFromEntity = unavailable;
    this.components.removeFromEntities = unavailable;
    this.components.setEntityData = unavailable;

    this.entities.create = unavailable;
    this.entities.destroy = unavailable;
    this.entities.query = unavailable;
    this.entities.queryList = unavailable;
    this.entities.querySnapshot = unavailable;

    this.systems.create = unavailable;
    this.systems.destroy = unavailable;
  }

  /** Copy an allocating stable array from a borrowed entity list. */
  #copyEntityList(list: QueryEntityList): Entity[] {
    const result = new Array<Entity>(list.count);
    for (let i = 0; i < list.count; i++) {
      result[i] = list.indices[i]!;
    }
    return result;
  }

  /** Copy an allocating stable array from a borrowed iterator. */
  #snapshotIterator(iterator: IterableIterator<Entity> | undefined): Entity[] | undefined {
    if (iterator === undefined) return undefined;
    const result: Entity[] = [];
    for (const entity of iterator) {
      result.push(entity);
    }
    return result;
  }

  /** Get the components for a query */
  #queryArchetypeComponents(query: Query): Record<string, DynamicComponentInstance> {
    return this.#queryManager.components(query);
  }

  /** Get the entities for a query */
  *#queryArchetypeEntities(query: Query): IterableIterator<Entity> {
    this.#visitedArchetypeEntities.clear();
    const queryInstance = this.#queryManager.instanceWithMembership(query);
    const archetypes = this.#archetypeManager.query(queryInstance);
    if (archetypes === undefined) {
      return;
    }
    for (const archetype of archetypes) {
      for (const entity of archetype.getEntities()) {
        if (this.#visitedArchetypeEntities.get(entity)) continue;
        this.#visitedArchetypeEntities.set(entity, true);
        yield entity;
      }
    }
    this.#visitedArchetypeEntities.clear();
  }

  /** Get entities that entered a query since last refresh */
  *#queryEnteredEntities(query: Query): IterableIterator<Entity> {
    this.#visitedArchetypeEntities.clear();
    const queryInstance = this.#queryManager.instanceWithMembership(query);
    const archetypes = this.#archetypeManager.query(queryInstance);
    if (archetypes === undefined) {
      return;
    }
    for (const archetype of archetypes) {
      for (const entity of archetype.getEntered()) {
        if (this.#visitedArchetypeEntities.get(entity)) continue;
        this.#visitedArchetypeEntities.set(entity, true);
        yield entity;
      }
    }
    this.#visitedArchetypeEntities.clear();
  }

  /** Get entities that exited a query since last refresh */
  *#queryExitedEntities(query: Query): IterableIterator<Entity> {
    this.#visitedArchetypeEntities.clear();
    const queryInstance = this.#queryManager.instanceWithMembership(query);
    const archetypes = this.#archetypeManager.query(queryInstance);
    if (archetypes === undefined) {
      return;
    }
    for (const archetype of archetypes) {
      for (const entity of archetype.getExited()) {
        if (this.#visitedArchetypeEntities.get(entity)) continue;
        const currentArchetype = this.#archetypeManager.getEntityArchetype(entity);
        if (currentArchetype?.isCandidate(queryInstance)) continue;
        this.#visitedArchetypeEntities.set(entity, true);
        yield entity;
      }
    }
    this.#visitedArchetypeEntities.clear();
  }

  /** Resolve a registered component instance for mutation paths. */
  #getRegisteredComponentInstance<T extends SchemaOrNull>(component: Component<T> | string): ComponentInstance<T> {
    const instance = this.#componentManager.getInstance(component);
    if (instance !== undefined) return instance;
    const name = typeof component === "string" ? `"${component}"` : `"${component.name}"`;
    throw new NotRegisteredError(`Component ${name} is not registered in this world.`);
  }

  /** Preflight a borrowed dense entity list before an atomic batch mutation. */
  #preflightBatchEntities(entities: QueryEntityList): number {
    const count = entities.count;
    if (!Number.isInteger(count) || count < 0 || count > this.#batchEntities.length) {
      throw new RangeError(`Batch entity list count ${count} is outside world capacity.`);
    }

    for (let i = 0; i < count; i++) {
      const entity = entities.indices[i]!;
      if (!this.#entityManager.isActive(entity)) {
        this.#clearBatchEntities(i);
        throw new EntityNotFoundError(`Entity ${entity} is not active.`);
      }
      if (this.#batchSeen[entity] === 1) {
        this.#clearBatchEntities(i);
        throw new RangeError(`Duplicate entity ${entity} in batch entity list.`);
      }
      this.#batchSeen[entity] = 1;
      this.#batchEntities[i] = entity;
    }

    return count;
  }

  /** Clear duplicate-detection scratch flags after batch preflight/commit. */
  #clearBatchEntities(count: number): void {
    for (let i = 0; i < count; i++) {
      const entity = this.#batchEntities[i]!;
      this.#batchSeen[entity] = 0;
      this.#batchEntities[i] = 0;
    }
  }

  /** Commit an already preflighted component add. */
  #commitAddComponent<T extends SchemaOrNull>(
    instance: ComponentInstance<T>,
    entity: Entity,
    data?: { [k in keyof T]: number },
  ): boolean {
    const changed = this.#componentManager.addInstanceToEntity(instance, entity, data);
    if (changed) {
      this.#archetypeManager.addComponent(entity, instance);
    }
    return changed;
  }

  /** Commit an already preflighted component removal. */
  #commitRemoveComponent<T extends SchemaOrNull>(
    instance: ComponentInstance<T>,
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
  #addComponentToEntity<T extends SchemaOrNull>(
    component: Component<T> | string,
    entity: Entity,
    data?: { [k in keyof T]: number } | undefined,
  ): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(`Entity ${entity} is not active.`);
    }
    const changed = this.#commitAddComponent(this.#getRegisteredComponentInstance(component), entity, data);
    this.#invalidateCommittedTransition(changed);
  }

  /** Add a component to every entity in a dense query list. */
  #addComponentToEntities<T extends SchemaOrNull>(
    component: Component<T> | string,
    entities: QueryEntityList,
    data?: { [k in keyof T]: number } | undefined,
  ): number {
    const instance = this.#getRegisteredComponentInstance(component);
    const count = this.#preflightBatchEntities(entities);

    try {
      const maxEntities = this.#componentManager.getInstanceMaxEntities(instance);
      if (maxEntities !== null) {
        let newOwners = 0;
        for (let i = 0; i < count; i++) {
          if (!this.#componentManager.entityOwnsInstance(instance, this.#batchEntities[i]!)) {
            newOwners++;
          }
        }
        if (this.#componentManager.getInstanceOwnerCount(instance) + newOwners > maxEntities) {
          throw new RangeError(
            `Component "${instance.type.name}" can only be added to ${maxEntities} entities.`,
          );
        }
      }

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
  #removeComponentFromEntity<T extends SchemaOrNull>(
    component: string | Component<T>,
    entity: Entity,
  ): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(`Entity ${entity} is not active.`);
    }
    const changed = this.#commitRemoveComponent(this.#getRegisteredComponentInstance(component), entity);
    this.#invalidateCommittedTransition(changed);
  }

  /** Remove a component from every entity in a dense query list. */
  #removeComponentFromEntities<T extends SchemaOrNull>(
    component: Component<T> | string,
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
  #getGuardedDataComponent<T extends SchemaOrNull>(
    component: Component<T> | string,
    entity: Entity,
  ): ComponentInstance<T> {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(`Entity ${entity} is not active.`);
    }
    const instance = this.#componentManager.getInstance(component);
    if (instance === undefined) {
      throw new NotRegisteredError(`Component ${component} not registered in world`);
    }
    if (instance.storage === null) {
      throw new ComponentDataError(`Component ${instance.type.name} has no data storage.`);
    }
    if (!this.#componentManager.entityOwnsInstance(instance, entity)) {
      throw new ComponentOwnershipError(`Entity ${entity} does not own component ${instance.type.name}.`);
    }
    return instance;
  }

  /** Get guarded component data for an active owning entity. */
  #getComponentEntityData<T extends SchemaOrNull>(
    component: Component<T> | string,
    entity: Entity,
  ): Record<keyof T, number> {
    return this.#componentManager.getInstanceEntityData(this.#getGuardedDataComponent(component, entity), entity)!;
  }

  /** Set guarded component data for an active owning entity. */
  #setComponentEntityData<T extends SchemaOrNull>(
    component: Component<T> | string,
    entity: Entity,
    value: Record<keyof T, number>,
  ): void {
    this.#componentManager.setInstanceEntityData(this.#getGuardedDataComponent(component, entity), entity, value);
  }

  /** Destroy an entity and clean up its components and archetype */
  #destroyEntity(entity: Entity): void {
    if (!this.#entityManager.isActive(entity)) {
      throw new EntityNotFoundError(`Entity ${entity} is not active.`);
    }
    // Get all components for this entity before destroying
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
    if (archetype) {
      // Remove all components from the entity
      for (const componentInstance of archetype.components) {
        this.#componentManager.removeInstanceFromEntity(componentInstance, entity);
      }
    }
    // Reset the entity to the root archetype
    this.#archetypeManager.reset(entity);
    // Destroy the entity itself
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
    this.#componentManager = new ComponentManager(capacity, components);

    this.#archetypeManager = new ArchetypeManager(capacity, components.length);
    this.#visitedArchetypeEntities = new BooleanArray(capacity);
    this.#batchEntities = createEntityArray(capacity);
    this.#batchSeen = new Uint8Array(capacity);

    this.#queryManager = new QueryManager(
      this,
      capacity,
      (queries) => {
        this.#archetypeManager.ensureQueryMembership(queries, true);
      },
      (query) => {
        this.#archetypeManager.registerQuery(query, true);
      },
    );
    this.#systemManager = new SystemManager(this, (query: Query) => this.#queryManager.components(query));

    // Public APIs
    const APIs: WorldAPIResult = this.#constructAPIs();
    this.archetypes = APIs.archetypes;
    this.components = APIs.components;
    this.entities = APIs.entities;
    this.systems = APIs.systems;
    this.#installUninitializedAPIs();
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
    // TODO: ensure everything is in its correct initial state - however, fromJSON world's shouldn't set everything to initial??
    try {
      this.#archetypeManager.init();
      this.#state = "initialized";
      this.#installInitializedAPIs();
      await this.#systemManager.init();
      this.#initResolver?.("initialized");
      this.refresh();
      assertWorldState("initialized", this.#state);
    } catch (error) {
      this.#state = "error";
      this.#installUnavailableAPIs();
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
      this.#installUnavailableAPIs();
    } catch (error) {
      this.#state = "error";
      this.#installUnavailableAPIs();
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
      this.#state = "error";
      throw error;
    }
  }
}
