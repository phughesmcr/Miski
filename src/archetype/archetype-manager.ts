// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';
import { World } from '../world';

export type Archetype = bigint;

export type ArchetypeRegistry = Map<Archetype, Set<Entity>>;

export interface ArchetypeManagerSpec {
  [key: string]: unknown;
}

export interface ArchetypeManager {
  addEntitiesToArchetype: (archetype: Archetype, ...entities: Entity[]) => World;
  getArchetypes: () => [Archetype, Set<Entity>][];
  getDirtyArchetypes: () => [Archetype, Set<Entity>][];
  getEntitiesFromArchetype: (archetype: Archetype) => Entity[] | undefined;
  isArchetypeDirty: (archetype: Archetype) => boolean;
  purgeDirtyArchetypeCache: () => World;
  removeEntitiesFromArchetype: (archetype: Archetype, ...entities: Entity[]) => World;
  updateArchetype: (entity: Entity, prev?: Archetype) => World;
}

function createAddEntitiesToArchetype(registry: ArchetypeRegistry, dirty: Set<Archetype>, world: World) {
  /**
   * Adds entities to an archetype's entity cache
   * @param archetype the archetype to modify
   * @param entities the entities to add to the archetype
   * @returns the world
   */
  function addEntitiesToArchetype(archetype: Archetype, ...entities: Entity[]): World {
    const set = registry.get(archetype);
    if (set) {
      entities.forEach((entity) => {
        if (!(set.has(entity))) {
          set.add(entity);
          dirty.add(archetype);
        }
      });
      return world;
    } else {
      throw new SyntaxError(`Archetype "${archetype}" does not exist.`);
    }
  }
  return addEntitiesToArchetype;
}

function createGetArchetypes(registry: Map<Archetype, Set<Entity>>) {
  /**
   * Get all the archetypes in the world
   * @returns an array of archetypes and their associated entities
   */
  function getArchetypes(): [Archetype, Set<Entity>][] {
    return [...registry.entries()];
  }
  return getArchetypes;
}

function createGetDirtyArchetypes(registry: ArchetypeRegistry, dirty: Set<Archetype>) {
  /**
   * Get all the archetypes in the world
   * which have been modified since the last world.step() or world.post()
   * @returns an array of dirty archetypes and their associated entities
   */
  function getDirtyArchetypes(): [Archetype, Set<Entity>][] {
    return [...dirty].reduce((arr, archetype) => {
      const entities = registry.get(archetype);
      if (entities) {
        arr.push([
          archetype,
          entities,
        ]);
      }
      return arr;
    }, new Array(dirty.size) as [Archetype, Set<Entity>][]);
  }
  return getDirtyArchetypes;
}

function createGetEntitiesFromArchetype(registry: ArchetypeRegistry) {
  /**
   * Returns an array of entities from a given archetype.
   * Invalid archetypes return empty arrays.
   * @param archetype the array to get entities from
   * @returns an array of entities
   */
  function getEntitiesFromArchetype(archetype: Archetype): Entity[] | undefined {
    return [...registry.get(archetype) ?? []];
  }
  return getEntitiesFromArchetype;
}

function createIsArchetypeDirty(dirty: Set<Archetype>) {
  /**
   * Check if an archetype has been modified since the last world.step() or world.post()
   * @param archetype the archetype to check
   * @returns true if the archetype has been modified since last step
   */
  function isArchetypeDirty(archetype: Archetype): boolean {
    return dirty.has(archetype);
  }
  return isArchetypeDirty;
}

// eslint-disable-next-line max-len
function createPurgeDirtyArchetypeCache(registry: ArchetypeRegistry, dirty: Set<Archetype>, removal: Set<Archetype>, world: World) {
  /**
   * @danger
   * Purge the cache of modified archetypes
   * You probably don't want to use this manually as the
   * archetype system handles this automatically.
   * @returns the world
   */
  function purgeDirtyArchetypeCache(): World {
    dirty.clear();
    removal.forEach((archetype) => registry.delete(archetype));
    removal.clear();
    return world;
  }
  return purgeDirtyArchetypeCache;
}

// eslint-disable-next-line max-len
function createRemoveEntitiesFromArchetype(registry: ArchetypeRegistry, dirty: Set<Archetype>, removal: Set<Archetype>, world: World) {
  /**
   * Remove entities from an archetype
   * @param archetype the archetype to remove entities from
   * @param entities the entities to remove from the archetype
   * @returns the world
   */
  function removeEntitiesFromArchetype(archetype: Archetype, ...entities: Entity[]): World {
    const set = registry.get(archetype);
    if (set) {
      entities.forEach((entity) => set.delete(entity));
      dirty.add(archetype);
      if (set.size === 0) {
        removal.add(archetype);
      }
    }
    return world;
  }
  return removeEntitiesFromArchetype;
}

// eslint-disable-next-line max-len
function createUpdateArchetype(registry: ArchetypeRegistry, dirty: Set<Archetype>, removal: Set<Archetype>, world: World) {
  const _adder = createAddEntitiesToArchetype(registry, dirty, world);
  const _remover = createRemoveEntitiesFromArchetype(registry, dirty, removal, world);
  /**
   * @danger
   * Update the archetype of an entity.
   * You probably don't want to use this manually as the
   * archetype system handles this automatically.
   * @param entity the entity to examine
   * @param previous the entity's previous archetype
   * @returns the world
   */
  function updateArchetype(entity: Entity, previous?: Archetype): World {
    if (previous !== undefined) {
      _remover(previous, entity);
    }
    const current = entity.getArchetype();
    if (registry.has(current)) {
      _adder(current, entity);
    } else {
      registry.set(current, new Set([entity]));
    }
    return world;
  }
  return updateArchetype;
}

/**
 * Creates a new archetype manager object
 * @param world the world associated with this manager
 * @param _spec the archetype manager specification
 * @returns the new archetype manager object
 */
export function createArchetypeManager(world: World, _spec: ArchetypeManagerSpec): ArchetypeManager {
  const registry: ArchetypeRegistry = new Map(); // all archetypes and associated entity caches
  const dirty: Set<Archetype> = new Set(); // archetypes modified since last world.step() or world.post()
  const removal: Set<Archetype> = new Set(); // empty archetypes to be removed on next world.step() or world.post()

  return {
    addEntitiesToArchetype: createAddEntitiesToArchetype(registry, dirty, world),
    getArchetypes: createGetArchetypes(registry),
    getDirtyArchetypes: createGetDirtyArchetypes(registry, dirty),
    getEntitiesFromArchetype: createGetEntitiesFromArchetype(registry),
    isArchetypeDirty: createIsArchetypeDirty(dirty),
    purgeDirtyArchetypeCache: createPurgeDirtyArchetypeCache(registry, dirty, removal, world),
    removeEntitiesFromArchetype: createRemoveEntitiesFromArchetype(registry, dirty, removal, world),
    updateArchetype: createUpdateArchetype(registry, dirty, removal, world),
  };
}
