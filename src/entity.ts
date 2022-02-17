/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { isUint32 } from "./utils.js";

/** Entities are indexes of an EntityArray */
export type Entity = number;

export interface EntityManagerSpec {
  availableEntities: Entity[];
  entityArchetypes: Archetype[];
  entityCapacity: number;
}

export interface EntityManager {
  createEntity: () => Entity | undefined;
  destroyEntity: (entity: Entity) => boolean;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  hasEntity: (entity: Entity) => boolean;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => boolean;
}

/**
 *
 * @param capacity
 * @returns
 */
function entityValidator(capacity: number): (entity: Entity) => entity is Entity {
  /** @return `true` if the given entity is valid for the given capacity */
  return function isValidEntity(entity: number): entity is Entity {
    if (!isUint32(entity) || entity > capacity) return false;
    return true;
  };
}

/** Manages the creation, destruction and recycling of entities */
export function createEntityManager(spec: EntityManagerSpec): Readonly<EntityManager> {
  if (!spec) throw new SyntaxError("EntityManager creation requires a spec object.");
  const { availableEntities, entityArchetypes, entityCapacity } = spec;
  const isValidEntity = entityValidator(entityCapacity);

  return Object.freeze({
    /** @returns the next available Entity or `undefined` if no Entity is available */
    createEntity(): Entity | undefined {
      return availableEntities.pop();
    },

    /**
     * Remove and recycle an Entity
     * @returns `true` if there was an archetype change
     */
    destroyEntity(entity: Entity): boolean {
      if (isValidEntity(entity) && entityArchetypes[entity] != undefined) {
        const a = entityArchetypes[entity];
        if (a) a.removeEntity(entity);
        availableEntities.push(entity);
        delete entityArchetypes[entity];
        return true;
      } else {
        delete entityArchetypes[entity]; // just in case
        return false;
      }
    },

    /** @returns the Entity's Archetype or undefined if Entity is not alive */
    getEntityArchetype(entity: Entity): Archetype | undefined {
      return entityArchetypes[entity];
    },

    /** @return `true` if the Entity !== undefined */
    hasEntity(entity: Entity): boolean {
      return isValidEntity(entity) && entityArchetypes[entity] !== undefined;
    },

    /** @returns `true` if the Archetype was changed successfully */
    setEntityArchetype(entity: Entity, archetype: Archetype): boolean {
      if (isValidEntity(entity)) {
        entityArchetypes[entity] = archetype;
        return true;
      }
      return false;
    },
  });
}
