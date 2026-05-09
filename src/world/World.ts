/**
 * @module      World
 * @description The World is the central context in which all Entities and Components exist.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";

import { $_ARCHETYPE_KEY, $_QUERY_KEY, VERSION } from "@/constants.ts";
import { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import { ComponentManager } from "@/component/component-manager.ts";
import { EntityManager } from "@/entity/entity-manager.ts";
import { EntityNotFoundError, NotRegisteredError, SpecError, WorldStateError } from "@/errors.ts";
import { QueryManager } from "@/query/query-manager.ts";
import { SystemManager } from "@/system/system-manager.ts";
import type { Component } from "@/component/component.ts";
import type { Archetype } from "@/archetype/archetype.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Query } from "@/query/query.ts";
import type {
  Entity,
  QueryEntityList,
  QueryInstance,
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
  /**
   * Construct the public APIs for the World
   * @param world - The World to construct the APIs for
   * @returns The public APIs for the World
   */
  static #constructAPIs(world: World): WorldAPIResult {
    // ARCHETYPES API

    /** Cache of entities visited by queryArchetypeEntities */
    const visitedArchetypeEntities = new BooleanArray(world.#entityManager.capacity);

    /**
     * Get the components for a query
     * @param query - The query to get the components for
     * @returns The components for the query
     */
    const queryArchetypeComponents = (query: Query): Record<string, ComponentInstance<any>> => {
      // Delegate to QueryManager which handles caching properly
      return world.#queryManager.components(query);
    };

    /**
     * Get the entities for a query
     * @param query - The query to get the entities for
     * @returns The entities for the query
     */
    const queryArchetypeEntities = (function* (query: Query): IterableIterator<Entity> {
      visitedArchetypeEntities.clear();
      const queryInstance = world.#queryManager.register(query);
      world.#archetypeManager.ensureQueryMembership(world.#queryManager.instancesByID.values(), true);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (archetypes === undefined) {
        return;
      }
      for (const archetype of archetypes) {
        for (const entity of archetype.getEntities()) {
          if (visitedArchetypeEntities.get(entity)) continue;
          visitedArchetypeEntities.set(entity, true);
          yield entity;
        }
      }
      visitedArchetypeEntities.clear();
    }).bind(world);

    // COMPONENTS API

    /**
     * Add a component to an entity
     * @param component - The component to add
     * @param entity - The entity to add the component to
     * @param data - The data to set for the component
     * @throws {NotRegisteredError} - If the component is not registered
     */
    const addComponentToEntity = <T extends SchemaOrNull<T>>(
      component: Component<T> | string,
      entity: Entity,
      data?: { [k in keyof T]: number } | undefined,
    ): void => {
      if (!world.#entityManager.isActive(entity)) {
        throw new EntityNotFoundError(`Entity ${entity} is not active.`);
      }
      const instance = world.#componentManager.getInstance(component);
      if (instance === undefined) {
        throw new NotRegisteredError(`Component ${component} not registered in world`);
      }
      const changed = world.#componentManager.addInstanceToEntity(instance, entity, data);
      if (changed) {
        world.#archetypeManager.addComponent(entity, instance);
      }
      if (changed && world.#state === "initialized" && !world.#queryManager.cacheInvalidated) {
        world.#queryManager.invalidate();
      }
    };

    /**
     * Add a component to every entity in a dense query list.
     * @param component - The component to add
     * @param entities - The dense entity list to mutate
     * @param data - The data to set for the component
     * @returns The number of changed entities
     */
    const addComponentToEntities = <T extends SchemaOrNull<T>>(
      component: Component<T> | string,
      entities: QueryEntityList,
      data?: { [k in keyof T]: number } | undefined,
    ): number => {
      const instance = world.#componentManager.getInstance(component);
      if (instance === undefined) {
        throw new NotRegisteredError(`Component ${component} not registered in world`);
      }

      let changedCount = 0;
      for (let i = 0; i < entities.count; i++) {
        const entity = entities.indices[i]!;
        if (!world.#entityManager.isActive(entity)) {
          throw new EntityNotFoundError(`Entity ${entity} is not active.`);
        }
        if (world.#componentManager.addInstanceToEntity(instance, entity, data)) {
          world.#archetypeManager.addComponent(entity, instance);
          changedCount++;
        }
      }
      if (changedCount > 0 && world.#state === "initialized" && !world.#queryManager.cacheInvalidated) {
        world.#queryManager.invalidate();
      }
      return changedCount;
    };

    /**
     * Remove a component from an entity
     * @param component - The component to remove
     * @param entity - The entity to remove the component from
     * @throws {NotRegisteredError} - If the component is not registered
     */
    const removeComponentFromEntity = <T extends SchemaOrNull<T>>(
      component: string | Component<T>,
      entity: Entity,
    ): void => {
      const instance = world.#componentManager.getInstance(component);
      if (instance === undefined) {
        throw new NotRegisteredError(`Component ${component} not registered in world`);
      }
      const changed = world.#componentManager.removeInstanceFromEntity(instance, entity);
      if (changed) {
        world.#archetypeManager.removeComponent(entity, instance);
      }
      if (changed && world.#state === "initialized" && !world.#queryManager.cacheInvalidated) {
        world.#queryManager.invalidate();
      }
    };

    /**
     * Remove a component from every entity in a dense query list.
     * @param component - The component to remove
     * @param entities - The dense entity list to mutate
     * @returns The number of changed entities
     */
    const removeComponentFromEntities = <T extends SchemaOrNull<T>>(
      component: Component<T> | string,
      entities: QueryEntityList,
    ): number => {
      const instance = world.#componentManager.getInstance(component);
      if (instance === undefined) {
        throw new NotRegisteredError(`Component ${component} not registered in world`);
      }

      let changedCount = 0;
      for (let i = 0; i < entities.count; i++) {
        const entity = entities.indices[i]!;
        if (world.#componentManager.removeInstanceFromEntity(instance, entity)) {
          world.#archetypeManager.removeComponent(entity, instance);
          changedCount++;
        }
      }
      if (changedCount > 0 && world.#state === "initialized" && !world.#queryManager.cacheInvalidated) {
        world.#queryManager.invalidate();
      }
      return changedCount;
    };

    // MAIN

    /**
     * Get entities that entered a query since last refresh
     * @param query - The query to check
     * @returns An iterable iterator of entities
     */
    const queryEnteredEntities = (function* (query: Query): IterableIterator<Entity> {
      visitedArchetypeEntities.clear();
      const queryInstance = world.#queryManager.register(query);
      world.#archetypeManager.ensureQueryMembership(world.#queryManager.instancesByID.values(), true);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (archetypes === undefined) {
        return;
      }
      for (const archetype of archetypes) {
        for (const entity of archetype.getEntered()) {
          if (visitedArchetypeEntities.get(entity)) continue;
          visitedArchetypeEntities.set(entity, true);
          yield entity;
        }
      }
      visitedArchetypeEntities.clear();
    }).bind(world);

    /**
     * Get entities that exited a query since last refresh
     * @param query - The query to check
     * @returns An iterable iterator of entities
     */
    const queryExitedEntities = (function* (query: Query): IterableIterator<Entity> {
      visitedArchetypeEntities.clear();
      const queryInstance = world.#queryManager.register(query);
      world.#archetypeManager.ensureQueryMembership(world.#queryManager.instancesByID.values(), true);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (archetypes === undefined) {
        return;
      }
      for (const archetype of archetypes) {
        for (const entity of archetype.getExited()) {
          if (visitedArchetypeEntities.get(entity)) continue;
          const currentArchetype = world.#archetypeManager.getEntityArchetype(entity);
          if (currentArchetype?.isCandidate(queryInstance)) continue;
          visitedArchetypeEntities.set(entity, true);
          yield entity;
        }
      }
      visitedArchetypeEntities.clear();
    }).bind(world);

    const archetypes: WorldArchetypeAPI = {
      getEntityArchetype: (entity: Entity) => world.#archetypeManager.getEntityArchetype(entity)?.id,
      isEntityInRoot: world.#archetypeManager.isEntityInRoot,
      queryComponents: queryArchetypeComponents,
      queryEntities: queryArchetypeEntities,
      queryEntered: queryEnteredEntities,
      queryExited: queryExitedEntities,
    };

    const components: WorldComponentAPI = {
      count: world.#componentManager.count,
      registry: world.#componentManager.registry,
      addToEntity: addComponentToEntity,
      addToEntities: addComponentToEntities,
      entityHas: world.#componentManager.entityHas,
      getChanged: world.#componentManager.getChanged,
      getEntityData: world.#componentManager.getEntityData,
      getInstance: world.#componentManager.getInstance,
      getInstances: world.#componentManager.getInstances,
      getOwners: world.#componentManager.getOwners,
      isRegistered: world.#componentManager.isRegistered,
      query: world.#queryManager.components,
      removeFromEntity: removeComponentFromEntity,
      removeFromEntities: removeComponentFromEntities,
      setEntityData: world.#componentManager.setEntityData,
    };

    /**
     * Destroy an entity and clean up its components and archetype
     * @param entity - The entity to destroy
     */
    const destroyEntity = (entity: Entity): void => {
      // Get all components for this entity before destroying
      const archetype = world.#archetypeManager.getEntityArchetype(entity);
      if (archetype) {
        // Remove all components from the entity
        for (const componentInstance of archetype.components) {
          world.#componentManager.removeInstanceFromEntity(componentInstance, entity);
        }
      }
      // Reset the entity to the root archetype
      world.#archetypeManager.reset(entity);
      // Destroy the entity itself
      world.#entityManager.destroy(entity);
      // Invalidate query caches
      world.#queryManager.invalidate();
    };

    const entities: WorldEntityAPI = {
      capacity: world.#entityManager.capacity,
      create: world.#entityManager.create,
      destroy: destroyEntity,
      getActive: world.#entityManager.getActive,
      getActiveCount: world.#entityManager.getActiveCount,
      getAvailableCount: world.#entityManager.getAvailableCount,
      isActive: world.#entityManager.isActive,
      isEntity: world.#entityManager.isEntity,
      query: world.#queryManager.entities,
      queryList: world.#queryManager.entityList,
    };

    const systems: WorldSystemAPI = {
      registry: world.#systemManager.registry,
      create: world.#systemManager.create,
      get: world.#systemManager.get,
      has: world.#systemManager.has,
      destroy: world.#systemManager.destroy,
    };

    return { archetypes, components, entities, systems };
  }

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

  /** Get an archetype by its ID */
  readonly [$_ARCHETYPE_KEY]: (id: string) => Archetype | undefined;

  /** The queries for the World */
  readonly [$_QUERY_KEY]: () => QueryInstance[];

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
    this[$_ARCHETYPE_KEY] = (id: string) => this.#archetypeManager.registry.get(id);

    // Wire up archetype manager for optimized component lookups
    this.#componentManager.setArchetypeManager(this.#archetypeManager);

    this.#queryManager = new QueryManager(this, capacity, (queries) => {
      this.#archetypeManager.ensureQueryMembership(queries, true);
    });
    this[$_QUERY_KEY] = () => [...this.#queryManager.instancesByID.values()];

    this.#systemManager = new SystemManager(this);

    // Public APIs
    const APIs: WorldAPIResult = World.#constructAPIs(this);
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
    // TODO: ensure everything is in its correct initial state - however, fromJSON world's shouldn't set everything to initial??
    try {
      this.#archetypeManager.init();
      await this.#systemManager.init(this);
      this.#state = "initialized";
      this.#initResolver?.("initialized");
      this.refresh();
      assertWorldState("initialized", this.#state);
    } catch (error) {
      this.#state = "error";
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
      this.#state = "error";
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
      this.#queryManager.invalidate();
    } catch (error) {
      this.#state = "error";
      throw error;
    }
  }
}
