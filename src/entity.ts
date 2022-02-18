/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { isUint32 } from "./utils.js";

/** Entities are indexes of an EntityArray */
export type Entity = number;

export interface EntityManagerSpec {
  entityArchetypes: Archetype[];
  capacity: number;
}

export interface EntityManager {
  createEntity: () => Entity | undefined;
  destroyEntity: (entity: Entity) => boolean;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  getVacancyCount: () => number;
  hasEntity: (entity: Entity) => boolean;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => boolean;
}

function createAvailableEntityArray(capacity: number): Entity[] {
  // @todo would this be better as a generator?
  return ((length: number) => {
    const total = length - 1;
    return Array.from({ length }, (_, i) => total - i);
  })(capacity);
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
  const { entityArchetypes, capacity } = spec;

  const availableEntities = createAvailableEntityArray(capacity);
  const isValidEntity = entityValidator(capacity);

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

    /** @returns the number of available entities */
    getVacancyCount() {
      return availableEntities.length;
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
