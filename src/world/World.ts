/**
 * @module      World
 * @description The World is the central context in which all Entities and Components exist.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { ArchetypeManager } from "../archetype/ArchetypeManager.ts";
import { type Component, isValidComponentArray } from "../component/Component.ts";
import { ComponentManager } from "../component/ComponentManager.ts";
import { VERSION } from "../constants.ts";
import { EntityManager } from "../entity/EntityManager.ts";
import { NotRegisteredError, SpecError, WorldStateError } from "../errors.ts";
import { QueryManager } from "../query/QueryManager.ts";
import { SystemManager } from "../system/SystemManager.ts";
import { isObject, isPositiveUint32 } from "../utils.ts";
import type {
  Entity,
  SchemaOrNull,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "../types.ts";
import type { Query } from "../query/Query.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";

/**
 * Test if an object is a valid WorldSpec
 * @param spec The object to test
 * @returns `true` if the object is a valid WorldSpec, `false` otherwise
 */
export function isValidWorldSpec(spec: unknown): spec is WorldSpec {
  if (isObject(spec) === false) return false;
  const { capacity, components } = spec;
  if (isPositiveUint32(capacity) === false) return false;
  if (isValidComponentArray(components) === false) return false;
  return true;
}

/** The World is the central context in which all Entities and Components exist. */
export class World {
  /**
   * Construct the public APIs for the World
   * @param world - The World to construct the APIs for
   * @returns The public APIs for the World
   */
  static #constructAPIs(world: World, capacity: number): WorldAPIResult {
    /**
     * Convenience function to get a component from a string or Component
     * @throws {NotRegisteredError} - If the component is not registered
     */
    const getComponentByName = <T extends SchemaOrNull<T>>(component: string | Component<T>): Component<T> => {
      if (typeof component === "string") {
        component = world.#componentManager.getInstance(component)?.proto as Component<T>;
        if (!component) {
          throw new NotRegisteredError(`Component ${component} not registered in world`);
        }
      }
      return component;
    };

    const queryArchetypeComponents = (query: Query): Record<string, ComponentInstance<any>> => {
      const queryInstance = world.#queryManager.register(query);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (!archetypes) return {};
      const components: Record<string, ComponentInstance<any>> = {};
      for (const archetype of archetypes) {
        for (const component of archetype.components) {
          components[component.name] = component;
        }
      }
      return components;
    };

    const queryArchetypeEntities = (query: Query): Set<Entity> => {
      const queryInstance = world.#queryManager.register(query);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (!archetypes) return new Set<Entity>();
      const entities = new Set<Entity>();
      for (const archetype of archetypes) {
        // TODO: do this with booleanarray!
        for (const entity of archetype.getEntities()) {
          entities.add(entity);
        }
      }
      return entities;
    };

    const queryArchetypes = (
      query: Query,
    ): [components: Record<string, ComponentInstance<any>>, entities: Set<Entity>] => {
      const queryInstance = world.#queryManager.register(query);
      const archetypes = world.#archetypeManager.query(queryInstance);
      if (!archetypes) return [{}, new Set<Entity>()];
      const components: Record<string, ComponentInstance<any>> = {};
      const entities = new Set<Entity>();
      for (const archetype of archetypes) {
        for (const component of archetype.components) {
          components[component.name] = component;
        }
        // TODO: do this with booleanarray!
        for (const entity of archetype.getEntities()) {
          entities.add(entity);
        }
      }
      return [components, entities];
    };

    /**
     * Add a component to an entity
     * @param component - The component to add
     * @param entity - The entity to add the component to
     * @param data - The data to set for the component
     * @throws {NotRegisteredError} - If the component is not registered
     */
    const addComponentToEntity = <T extends SchemaOrNull<T>>(
      component: string | Component<T>,
      entity: Entity,
      data?: { [k in keyof T]: number } | undefined,
    ): void => {
      component = getComponentByName(component);
      world.#componentManager.addToEntity(component, entity, data);
      world.#archetypeManager.update(entity, world.#archetypeManager.getEntityComponents(entity));
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
      component = getComponentByName(component);
      world.#componentManager.removeFromEntity(component, entity);
      world.#archetypeManager.update(entity, world.#archetypeManager.getEntityComponents(entity));
    };

    const archetypes: WorldArchetypeAPI = {
      isEntityInRoot: world.#archetypeManager.isEntityInRoot,
      query: queryArchetypes,
      queryComponents: queryArchetypeComponents,
      queryEntities: queryArchetypeEntities,
    };

    const components: WorldComponentAPI = {
      all: world.#componentManager.all,
      count: world.#componentManager.count,
      registry: world.#componentManager.registry,
      addToEntity: addComponentToEntity,
      entityOwns: world.#componentManager.entityOwns,
      getChanged: world.#componentManager.getChanged,
      getEntityData: world.#componentManager.getEntityData,
      getInstance: world.#componentManager.getInstance,
      getOwners: world.#componentManager.getOwners,
      isRegistered: world.#componentManager.isRegistered,
      query: world.#queryManager.components,
      removeFromEntity: removeComponentFromEntity,
      setEntityData: world.#componentManager.setEntityData,
    };

    const entities: WorldEntityAPI = {
      capacity,
      active: world.#entityManager.active,
      create: world.#entityManager.create,
      destroy: world.#entityManager.destroy,
      exists: world.#entityManager.isActive,
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

  /** Archetype Management API */
  readonly archetypes: WorldArchetypeAPI;

  /** Entity Management API */
  readonly entities: WorldEntityAPI;

  /** Component Management API */
  readonly components: WorldComponentAPI;

  /** System Management API */
  readonly systems: WorldSystemAPI;

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

    const { capacity, components } = spec;
    this.#archetypeManager = new ArchetypeManager(capacity);
    this.#componentManager = new ComponentManager(capacity, components);
    this.#entityManager = new EntityManager(capacity);
    this.#queryManager = new QueryManager(this, capacity);
    this.#systemManager = new SystemManager(this);
    this.#queryManager = new QueryManager(this, capacity);
    this.#systemManager = new SystemManager(this);

    const APIs: WorldAPIResult = World.#constructAPIs(this, capacity);
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
   * @returns The World
   * @throws {WorldStateError} - If the World is already initialized, or has already been destroyed
   */
  async init(): Promise<this> {
    if (this.#state === "initialized") {
      throw new WorldStateError("World has already been initialized");
    } else if (this.#state === "destroyed") {
      throw new WorldStateError("World has already been destroyed");
    }
    // TODO: ensure everything is in its correct initial state - however, fromJSON world's shouldn't set everything to initial??
    this.#archetypeManager.init();
    await this.#systemManager.init(this);
    this.#state = "initialized";
    return this;
  }

  /**
   * Destroy the World
   * @returns The World
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed
   */
  async destroy(): Promise<this> {
    if (this.#state === "uninitialized") {
      throw new WorldStateError("World has not been initialized");
    } else if (this.#state === "destroyed") {
      throw new WorldStateError("World has already been destroyed");
    }
    // TODO: destroy everything and clearing up memory
    await this.#systemManager.destroyAll(this);
    this.#state = "destroyed";
    return this;
  }

  /**
   * Run routine maintenance on the World
   * @returns The world
   * @throws {WorldStateError} - If the World has not yet been initialized, or has already been destroyed
   */
  refresh(): this {
    if (this.#state === "uninitialized") {
      throw new WorldStateError("World has not been initialized");
    } else if (this.#state === "destroyed") {
      throw new WorldStateError("World has already been destroyed");
    }
    this.#archetypeManager.refresh(this.#queryManager.registry.values());
    this.#componentManager.refresh();
    this.#queryManager.invalidate();
    return this;
  }
}
