/**
 * @module      World
 * @description The World is the central context in which all Entities and Components exist.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import type { Archetype } from "@/archetype/archetype.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import { ComponentManager } from "@/component/component-manager.ts";
import type { Component } from "@/component/component.ts";
import { EntityManager } from "@/entity/entity-manager.ts";
import { QueryManager } from "@/query/query-manager.ts";
import type { Query } from "@/query/query.ts";
import { $_ARCHETYPE_KEY, $_QUERY_KEY, VERSION } from "@/shared/constants.ts";
import { BooleanArray } from "@/shared/deps.ts";
import { NotRegisteredError, SpecError, WorldStateError } from "@/shared/errors.ts";
import type {
  Entity,
  QueryInstance,
  SchemaOrNull,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/shared/types.ts";
import { SystemManager } from "@/system/system-manager.ts";
import { assertWorldState, isValidWorldSpec } from "@/world/utils.ts";

/**
 * Central runtime context that owns entities, components, archetypes, queries, and systems.
 *
 * @remarks
 * - Exposes high-level APIs grouped under `archetypes`, `components`, `entities`, and `systems`.
 * - Most iterators returned by query-related APIs are ephemeral; consume them immediately.
 */
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
      // Note: This iterator is ephemeral and only valid until the next world refresh
      // or mutation that invalidates query caches. Consume immediately; do not store.
      visitedArchetypeEntities.clear();
      const queryInstance = world.#queryManager.register(query);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (archetypes === undefined) {
        return;
      }
      for (const archetype of archetypes) {
        for (const entity of archetype.getEntities()) {
          if (visitedArchetypeEntities.get(entity)) continue;
          if (!world.#entityManager.isActive(entity)) continue;
          visitedArchetypeEntities.set(entity, true);
          yield entity;
        }
      }
      visitedArchetypeEntities.clear();
    }).bind(world);

    // COMPONENTS API

    /**
     * Convenience function to get a component from a string or Component
     * @throws {NotRegisteredError} - If the component is not registered
     */
    const getComponentByName = <T extends SchemaOrNull<T>>(component: string | Component<T>): Component<T> => {
      if (typeof component === "string") {
        const resolved = world.#componentManager.getInstance(component)?.type as Component<T> | undefined;
        if (resolved === undefined) {
          throw new NotRegisteredError(`Component "${component}" not registered in world`);
        }
        return resolved;
      }
      return component;
    };

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
        throw new NotRegisteredError(`Entity ${entity} not active`);
      }
      component = getComponentByName(component);
      const instances = world.#componentManager.addToEntity(component, entity, data);
      world.#archetypeManager.update(entity, instances);
      if (world.#state === "initialized") {
        world.refresh(true);
      }
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
      if (!world.#entityManager.isActive(entity)) {
        throw new NotRegisteredError(`Entity ${entity} not active`);
      }
      component = getComponentByName(component);
      const instances = world.#componentManager.removeFromEntity(component, entity);
      world.#archetypeManager.update(entity, instances);
      if (world.#state === "initialized") {
        world.refresh(true);
      }
    };

    // MAIN

    /**
     * Get entities that entered a query since last refresh
     * @param query - The query to check
     * @returns An iterable iterator of entities
     */
    const queryEnteredEntities = (function* (query: Query): IterableIterator<Entity> {
      // Note: This iterator is ephemeral and only valid until the next world refresh
      // or mutation that invalidates query caches. Consume immediately; do not store.
      visitedArchetypeEntities.clear();
      const queryInstance = world.#queryManager.register(query);
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
      // Note: This iterator is ephemeral and only valid until the next world refresh
      // or mutation that invalidates query caches. Consume immediately; do not store.
      visitedArchetypeEntities.clear();
      const queryInstance = world.#queryManager.register(query);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (archetypes === undefined) {
        return;
      }
      for (const archetype of archetypes) {
        for (const entity of archetype.getExited()) {
          if (visitedArchetypeEntities.get(entity)) continue;
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

    const guardedSetEntityData = function <T extends SchemaOrNull<T>>(
      component: Component<T> | string,
      entity: Entity,
      value?: Record<keyof T, number>,
    ): void {
      if (!world.#entityManager.isActive(entity)) {
        throw new NotRegisteredError(`Entity ${entity} not active`);
      }
      if (value !== undefined) {
        world.#componentManager.setEntityData(component, entity, value);
      }
    };

    const components: WorldComponentAPI = {
      count: world.#componentManager.count,
      registry: world.#componentManager.registry,
      addToEntity: addComponentToEntity,
      entityHas: world.#componentManager.entityHas,
      getChanged: world.#componentManager.getChanged,
      getEntityData: world.#componentManager.getEntityData,
      getInstance: world.#componentManager.getInstance,
      getInstances: world.#componentManager.getInstances,
      getOwners: world.#componentManager.getOwners,
      isRegistered: world.#componentManager.isRegistered,
      query: world.#queryManager.components,
      removeFromEntity: removeComponentFromEntity,
      setEntityData: guardedSetEntityData,
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
          world.#componentManager.removeFromEntity(componentInstance.type, entity);
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
   * Create a new World.
   * @param spec - The world specification, including `capacity` and `components`.
   * @throws {SpecError} - If the provided spec object is invalid.
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

    this.#queryManager = new QueryManager(this, capacity, (entity: Entity) => this.#entityManager.isActive(entity));
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
   * Initialize the World.
   * @throws {WorldStateError} - If the World is already initialized, or has already been destroyed.
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
   * Destroy the World.
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed.
   */
  async destroy(): Promise<void> {
    assertWorldState("initialized", this.#state);
    try {
      await this.#systemManager.destroyAll();

      // Fully clean up entities and components
      const activeEntities = [...this.#entityManager.getActive()];
      for (const entity of activeEntities) {
        const archetype = this.#archetypeManager.getEntityArchetype(entity);
        if (archetype) {
          for (const componentInstance of archetype.components) {
            this.#componentManager.removeFromEntity(componentInstance.type, entity);
          }
        }
        this.#archetypeManager.reset(entity);
        this.#entityManager.destroy(entity);
      }

      // Invalidate query caches after cleanup
      this.#queryManager.invalidate();

      this.#state = "destroyed";
    } catch (error) {
      this.#state = "error";
      throw error;
    }
  }

  /**
   * Wait for the World to be ready.
   * @throws {WorldStateError} - If the World has already been destroyed or has encountered an error.
   */
  async onReady(): Promise<void> {
    const state = await this.#initPromise;
    if (state !== "initialized") {
      throw new WorldStateError(`World failed to initialize: state is "${state}"`);
    }
  }

  /**
   * Run routine maintenance on the World.
   * @param retainChanged - When `true`, preserves component "changed" flags.
   * @param retainDeltas - When `true`, preserves archetype entered/exited deltas.
   * Defaults to `retainChanged` when omitted.
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed.
   */
  refresh(retainChanged: boolean = false, retainDeltas: boolean = false): void {
    assertWorldState("initialized", this.#state);
    try {
      const retainArchetypeDeltas = arguments.length >= 2 ? retainDeltas : retainChanged;
      // Clear archetype deltas unless we are explicitly retaining them
      this.#archetypeManager.refresh(this.#queryManager.instancesByID.values(), !retainArchetypeDeltas);
      // Clear component changed flags unless we are explicitly retaining them
      if (!retainChanged) this.#componentManager.refresh();
      // Invalidate query caches regardless
      this.#queryManager.invalidate();
    } catch (error) {
      this.#state = "error";
      throw error;
    }
  }
}
