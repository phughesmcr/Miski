/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { createArchetypeManager } from "./archetype/manager.js";
import { bitfieldFactory } from "./bitfield.js";
import { Component, ComponentRecord } from "./component/component.js";
import { createComponentManager } from "./component/manager.js";
import { SchemaProps } from "./component/schema.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { createEntityManager, Entity } from "./entity.js";
import { createQueryManager } from "./query/manager.js";
import { Query } from "./query/query.js";
import { createSerializationManager, MiskiData } from "./serialize.js";
import { isUint32 } from "./utils.js";

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
  /**
   * Check if an entity has a given component.
   * @param entity the entity to check.
   * @param component the component to check for.
   * @returns `true` if the entity has the component.
   */
  entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
  /**
   * Get a given entity's archetype.
   * @param entity the entity to expose.
   * @returns the Archetype object or `undefined` if no archetype found.
   */
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  /** @returns an array of entities which have entered a query's archetypes since last world.refresh() */
  getQueryEntered: (query: Query) => Entity[];
  /** @returns an array of entities which have left a query's archetypes since last world.refresh() */
  getQueryExited: (query: Query) => Entity[];
  /** @returns a tuple of entities and components which match the query's criteria */
  getQueryResult: (query: Query) => [Entity[], ComponentRecord];
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

  const { createBitfieldFromIds, isBitOn, toggleBit } = bitfieldFactory(components.length);

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
      createBitfieldFromIds,
      getEntityArchetype,
      setEntityArchetype,
      toggleBit,
    });

  const { componentMap, addComponentToEntity, entityHasComponent, getBuffer, removeComponentFromEntity, setBuffer } =
    createComponentManager({
      capacity,
      components,
      getEntityArchetype,
      isBitOn,
      isValidEntity,
      updateArchetype,
    });

  const { queryMap, getQueryEntered, getQueryExited, getQueryResult, refreshQuery } = createQueryManager({
    createBitfieldFromIds,
    componentMap,
    isArchetypeCandidate,
  });

  const { load, save } = createSerializationManager({ getBuffer, setBuffer });

  function purgeCaches() {
    [...archetypeMap.values()].forEach(purgeArchetypeCaches);
  }
  purgeCaches();

  function refresh() {
    const archetypes = [...archetypeMap.values()];
    const queryRefresher = refreshQuery(archetypes);
    queryMap.forEach(queryRefresher);
    archetypes.forEach(refreshArchetype);
  }
  refresh();

  return Object.freeze(
    Object.assign(Object.create(WORLD_PROTO), {
      capacity,
      addComponentToEntity,
      createEntity,
      destroyEntity,
      entityHasComponent,
      getEntityArchetype,
      getQueryEntered,
      getQueryExited,
      getQueryResult,
      getVacancyCount,
      hasEntity,
      load,
      purgeCaches,
      refresh,
      removeComponentFromEntity,
      save,
    }) as World,
  );
}
