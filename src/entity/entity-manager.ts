/**
 * @name        EntityManager
 * @description The entity manager creates, destroys and manages the state of entities in the world.
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { Bitmask, createBitmask, getBitFromMask, getFirstFree, isBitOn, setBitOff, setBitOn } from "../utils/bitmasks";
import { World } from "../world";

/** Entities are indexes. */
export type Entity = number;

/** Entity availability state is stored in a Uint8Array bitmask. */
export type EntityRegistry = Bitmask;

/**
 * Entity availability state.
 * 1 = unavailable
 * 0 = available
 */
export type EntityState = 0 | 1;

export interface EntityManager {
  createEntity: () => Entity;
  destroyEntity: (entity: Entity) => World;
  getEntityState: (entity: Entity) => EntityState | undefined;
  isEntityRegistered: (entity: Entity) => boolean;
}

function _createEntity(states: EntityRegistry) {
  /**
   * Creates a new entity
   * @returns an entity
   */
  function createEntity(): Entity {
    const entity = getFirstFree(states);
    if (entity === undefined) {
      throw new Error("createEntity: No available entities. Maximum entities reached.");
    }
    setBitOn(states, entity);
    return entity;
  }
  return createEntity;
}

function _destroyEntity(states: EntityRegistry, world: World) {
  /**
   * Destroys a given entity and marks it as recyclable
   * @param entity the entity to destroy
   * @returns the world
   */
  function destroyEntity(entity: Entity): World {
    if (isBitOn(states, entity)) {
      world.stripEntity(entity);
      setBitOff(states, entity);
    }
    return world;
  }
  return destroyEntity;
}

function _isEntityRegistered(states: EntityRegistry) {
  /**
   * Check if an entity is active in the world
   * @param entity the entity to test
   * @returns true if the entity is active in the world
   */
  function isEntityRegistered(entity: Entity): boolean {
    return isBitOn(states, entity);
  }
  return isEntityRegistered;
}

function _getEntityState(states: EntityRegistry) {
  /**
   * Get the state of a given entity
   * @param entity the entity to get the state of
   * @returns the state of the entity or undefined if entity not in world
   */
  function getEntityState(entity: Entity): EntityState | undefined {
    return getBitFromMask(states, entity);
  }
  return getEntityState;
}

export function createEntityManager(world: World): EntityManager {
  const { maxEntities } = world.config;

  const states: Bitmask = createBitmask(maxEntities);

  return {
    createEntity: _createEntity(states),
    destroyEntity: _destroyEntity(states, world),
    getEntityState: _getEntityState(states),
    isEntityRegistered: _isEntityRegistered(states),
  };
}
