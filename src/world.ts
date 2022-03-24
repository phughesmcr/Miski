/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { createArchetypeManager } from "./archetype/manager.js";
import { bitfieldFactory } from "./bitfield.js";
import type { Component } from "./component/component.js";
import { refreshComponentInstance } from "./component/instance.js";
import { ComponentRecord, createComponentManager } from "./component/manager.js";
import type { SchemaProps } from "./component/schema.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { createEntityManager, Entity } from "./entity.js";
import { createQueryManager } from "./query/manager.js";
import type { Query } from "./query/query.js";
import { createSerializationManager, MiskiData } from "./serialize.js";
import { isUint32 } from "./utils/utils.js";

export interface WorldSpec {
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** Components to instantiate in the world  */
  components: Component<unknown>[];
}

export interface World {
  /** The maximum number of entities allowed in the world */
  readonly capacity: number;
  /** The Miski version used to create this World */
  readonly version: string;
  /** Add multiple components to an entity at once by defining a prefab. */
  addComponentsToEntity: (
    ...components: Component<unknown>[]
  ) => (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => boolean;
  /**
   * Add a component to an entity.
   * @param component the component to add.
   * @param entity the entity to add the component to.
   * @param props optional initial component values to set for the entity.
   * @returns `true` if the component was added successfully.
   */
  addComponentToEntity: <T>(component: Component<T>) => (entity: Entity, properties?: SchemaProps<T>) => boolean;
  /**
   * Create a new entity for use in the world.
   * @returns the entity or `undefined` if no entities were available.
   */
  createEntity: () => Entity | undefined;
  /**
   * Destroy a given entity.
   * @returns `true` if the entity was successfully destroyed.
   */
  destroyEntity: (entity: Entity) => boolean;
  /** Get all component properties for a given entity */
  getEntityProperties: (entity: Entity) => Record<string, SchemaProps<unknown>>;
  /** @returns an array of entities which have entered a query's archetypes since last world.refresh() */
  getQueryEntered: (query: Query) => Entity[];
  /** @returns an array of entities which have left a query's archetypes since last world.refresh() */
  getQueryExited: (query: Query) => Entity[];
  /** @returns a tuple of entities and components which match the query's criteria */
  getQueryResult: (query: Query) => [ComponentRecord, () => Entity[]];
  /** @returns the number of available entities in the world. */
  getVacancyCount: () => number;
  /** Test a single component against a single entity */
  hasComponent: <T>(component: Component<T>) => (entity: Entity) => boolean;
  /** @returns `true` if the entity is valid and !== undefined */
  hasEntity: (entity: Entity) => boolean;
  /**
   * Load data into the world.
   * @param data the MiskiData object to load
   * @returns `true` if all the data was successfully loaded into the world.
   */
  load: (data: MiskiData) => boolean;
  /**
   * Purge various caches throughout the world.
   * Should not be necessary but useful if memory footprint is creeping.
   */
  purgeCaches: () => void;
  /**
   * Run various maintenance functions in the world.
   * Recommended once per frame.
   */
  refresh: () => void;
  /**
   * Remove a component from an entity.
   * @param component the component to remove.
   * @param entity the entity to remove the component from.
   * @returns `true` if the component was removed successfully.
   */
  removeComponentFromEntity: <T>(component: Component<T>) => (entity: Entity) => boolean;
  /** Remove multiple components from an entity at once. */
  removeComponentsFromEntity: (...components: Component<unknown>[]) => (entity: Entity) => boolean;
  /** Serialize various aspects of the world's data */
  save: () => Readonly<MiskiData>;
  /** Reduces an array of entities to just those who have all the desired components */
  withComponents: (...components: Component<unknown>[]) => (...entities: Entity[]) => Entity[];
}

function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  if (!spec) throw new SyntaxError("World creation requires a specification object.");
  const { capacity = DEFAULT_MAX_ENTITIES, components } = spec;
  if (!isUint32(capacity)) throw new SyntaxError("World creation: spec.capacity invalid.");
  if (!components.length) throw new SyntaxError("World creation: spec.components invalid.");
  return { capacity, components };
}

/**
 * Create a new World object
 * @param spec The world's specification object
 * @param spec.capacity The maximum number of entities allowed in the world
 * @param spec.components Components to instantiate in the world
 * @returns a new, frozen World object
 */
export function createWorld(spec: WorldSpec): Readonly<World> {
  const { capacity, components } = validateWorldSpec(spec);

  // eslint-disable-next-line prettier/prettier
  const {
    EMPTY_BITFIELD,
    createBitfieldFromIds,
    isBitOn,
    toggleBit,
  } = bitfieldFactory(components.length);

  const {
    EMPTY_ARCHETYPE,
    getEntityArchetype,
    purgeArchetypesCaches,
    refreshArchetypes,
    removeEntityFromArchetype,
    setEntityArchetype,
    updateArchetype,
  } = createArchetypeManager({
    EMPTY_BITFIELD,
    capacity,
    toggleBit,
  });

  // eslint-disable-next-line prettier/prettier
  const {
    createEntity,
    destroyEntity,
    getVacancyCount,
    hasEntity,
    isValidEntity,
  } = createEntityManager({
    capacity,
    EMPTY_ARCHETYPE,
    getEntityArchetype,
    removeEntityFromArchetype,
    setEntityArchetype,
  });

  const {
    componentMap,
    addComponentsToEntity,
    addComponentToEntity,
    getBuffer,
    getEntityProperties,
    hasComponent,
    removeComponentFromEntity,
    removeComponentsFromEntity,
    setBuffer,
    withComponents,
  } = createComponentManager({
    capacity,
    components,
    getEntityArchetype,
    isBitOn,
    isValidEntity,
    updateArchetype,
  });

  // eslint-disable-next-line prettier/prettier
  const {
    queryMap,
    getQueryEntered,
    getQueryExited,
    getQueryResult,
  } = createQueryManager({
    createBitfieldFromIds,
    componentMap,
  });

  // eslint-disable-next-line prettier/prettier
  const {
    load,
    save
  } = createSerializationManager({
    getBuffer,
    setBuffer,
    version: VERSION,
  });

  const purgeCaches = () => {
    purgeArchetypesCaches();
  };
  purgeCaches();

  const refresh = () => {
    refreshArchetypes(queryMap);
    componentMap.forEach(refreshComponentInstance);
  };
  refresh();

  return Object.freeze({
    capacity,
    version: VERSION,

    addComponentsToEntity,
    addComponentToEntity,
    createEntity,
    destroyEntity,
    getEntityProperties,
    getQueryEntered,
    getQueryExited,
    getQueryResult,
    getVacancyCount,
    hasComponent,
    hasEntity,
    load,
    purgeCaches,
    refresh,
    removeComponentFromEntity,
    removeComponentsFromEntity,
    save,
    withComponents,
  }) as World;
}
