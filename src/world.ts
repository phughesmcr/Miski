/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { createArchetypeManager } from "./archetype/manager.js";
import { bitfieldFactory } from "./bitfield.js";
import { Component } from "./component/component.js";
import { refreshComponentInstance } from "./component/instance.js";
import { createComponentManager, ComponentRecord } from "./component/manager.js";
import { SchemaProps } from "./component/schema.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { createEntityManager, Entity } from "./entity.js";
import { createQueryManager } from "./query/manager.js";
import { Query } from "./query/query.js";
import { createSerializationManager, MiskiData } from "./serialize.js";
import { isUint32 } from "./utils/utils.js";

export interface WorldSpec {
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** Components to instantiate in the world  */
  components: Component<unknown>[];
}

interface WorldProto {
  /** The Miski version used to create this World */
  readonly version: string;
}

export interface World extends WorldProto {
  /** The maximum number of entities allowed in the world */
  readonly capacity: number;
  /**
   * Add a component to an entity.
   * @param component the component to add.
   * @param entity the entity to add the component to.
   * @param props optional initial component values to set for the entity.
   * @returns `true` if the component was added successfully.
   */
  addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T> | undefined) => boolean;
  /** Add multiple components to an entity at once by defining a prefab. */
  addComponentsToEntity: (components: Component<unknown>[]) => (entity: Entity) => boolean[];
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
  /** Test a single component against a single entity */
  hasComponent: <T>(components: Component<T>) => (entity: Entity) => boolean;
  /**
   * returns a 2d array, first indexed by entity, then by component id.
   * @returns [entity: [component.id: boolean]]
   * @example
   *  const hasRenderables = hasComponents({ id: 21 }, { id: 99 });
   *  const state = hasRenderables(10, 33, 75);
   *  // state[10][21] = whether entity 10 has component 21;
   *  // state[33][99] = whether entity 33 has component 99;
   *  // state[0][99] = will throw because state[0] is undefined;
   */
  hasComponents: (...components: Component<unknown>[]) => (...entities: Entity[]) => boolean[][];
  /**
   * returns an array, indexed by entity,
   * containing `true` if the entity has all the desired components.
   * @returns [entity: boolean]
   * @example
   *  const hasRenderables = hasComponents({ id: 21 }, { id: 99 });
   *  const state = hasRenderables(10, 33, 75);
   *  // state[10] = whether entity 10 has both components 21 & 99;
   *  // state[33] = whether entity 33 has both components 21 & 99;
   *  // state[0] = will be undefined;
   */
  hasAllComponents: (...components: Component<unknown>[]) => (...entities: Entity[]) => boolean[];
  /**
   * Get a given entity's archetype.
   * @param entity the entity to expose.
   * @returns the Archetype object or `undefined` if no archetype found.
   */
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  /** Get all component properties for a given entity */
  getEntityProperties: (entity: Entity) => { [key: string]: SchemaProps<unknown> };
  /** @returns an array of entities which have entered a query's archetypes since last world.refresh() */
  getQueryEntered: (query: Query) => Entity[];
  /** @returns an array of entities which have left a query's archetypes since last world.refresh() */
  getQueryExited: (query: Query) => Entity[];
  /** @returns a tuple of entities and components which match the query's criteria */
  getQueryResult: (query: Query) => [() => Entity[], ComponentRecord];
  /** @returns a tuple of entities and components which match the query's criteria */
  getQueryResults: (queries: Query[]) => [() => Entity[], ComponentRecord];
  /** @returns the number of available entities in the world. */
  getVacancyCount: () => number;
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
  removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;
  /** Remove multiple components from an entity at once. */
  removeComponentsFromEntity: (components: Component<unknown>[]) => (entity: Entity) => boolean[];
  /** Serialize various aspects of the world's data */
  save: () => Readonly<MiskiData>;
}

/** World.prototype - Miski version data etc. */
const WORLD_PROTO: Readonly<WorldProto> = Object.freeze({
  version: VERSION,
});

function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  if (!spec) throw new SyntaxError("World creation requires a specification object.");
  const { capacity = DEFAULT_MAX_ENTITIES, components } = spec;
  if (!isUint32(capacity)) throw new SyntaxError("World creation: spec.capacity invalid.");
  if (!components.length) throw new SyntaxError("World creation: spec.components invalid.");
  return { capacity, components };
}

export function createWorld(spec: WorldSpec): Readonly<World> {
  const { capacity, components } = validateWorldSpec(spec);

  const { EMPTY_BITFIELD, createBitfieldFromIds, isBitOn, toggleBit } = bitfieldFactory(components.length);

  const {
    createEntity,
    destroyEntity,
    getEntityArchetype,
    getVacancyCount,
    hasEntity,
    isValidEntity,
    setEntityArchetype,
  } = createEntityManager({ capacity });

  const { archetypeMap, isArchetypeCandidate, purgeArchetypeCaches, refreshArchetype, updateArchetype } =
    createArchetypeManager({
      EMPTY_BITFIELD,
      getEntityArchetype,
      setEntityArchetype,
      toggleBit,
    });

  const {
    componentMap,
    addComponentToEntity,
    addComponentsToEntity,
    hasAllComponents,
    hasComponent,
    hasComponents,
    removeComponentsFromEntity,
    getEntityProperties,
    getBuffer,
    removeComponentFromEntity,
    setBuffer,
  } = createComponentManager({
    capacity,
    components,
    getEntityArchetype,
    isBitOn,
    isValidEntity,
    updateArchetype,
  });

  const { queryMap, getQueryEntered, getQueryExited, getQueryResult, getQueryResults, refreshQuery } =
    createQueryManager({
      createBitfieldFromIds,
      componentMap,
      isArchetypeCandidate,
    });

  const { load, save } = createSerializationManager({ getBuffer, setBuffer, version: VERSION });

  function purgeCaches() {
    [...archetypeMap.values()].forEach(purgeArchetypeCaches);
  }
  purgeCaches();

  function refresh() {
    const archetypes = [...archetypeMap.values()];
    const queryRefresher = refreshQuery(archetypes);
    queryMap.forEach(queryRefresher);
    archetypes.forEach(refreshArchetype);
    componentMap.forEach(refreshComponentInstance);
  }
  refresh();

  return Object.freeze(
    Object.assign(Object.create(WORLD_PROTO), {
      capacity,
      addComponentsToEntity,
      addComponentToEntity,
      createEntity,
      destroyEntity,
      getEntityArchetype,
      getEntityProperties,
      getQueryEntered,
      getQueryExited,
      getQueryResult,
      getQueryResults,
      getVacancyCount,
      hasAllComponents,
      hasComponent,
      hasComponents,
      hasEntity,
      load,
      purgeCaches,
      refresh,
      removeComponentFromEntity,
      removeComponentsFromEntity,
      save,
    }) as World,
  );
}
