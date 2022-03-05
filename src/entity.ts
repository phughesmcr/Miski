/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype, removeEntityFromArchetype } from "./archetype/archetype.js";
import { isUint32, Opaque } from "./utils.js";

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
export type Entity = Opaque<number, "Entity">;

interface EntityManagerSpec {
  capacity: number;
}

interface EntityManager {
  createEntity: () => Entity | undefined;
  destroyEntity: (entity: Entity) => boolean;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  getVacancyCount: () => number;
  hasEntity: (entity: Entity) => boolean;
  isValidEntity: (entity: Entity) => entity is Entity;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => boolean;
}

function createEntityArchetypeArray(capacity: number) {
  const entityArchetypes: Archetype[] = [];
  entityArchetypes.length = capacity; // @note V8 hack, quicker/smaller than new Array(capacity)
  return entityArchetypes;
}

function createAvailableEntityArray(capacity: number): Entity[] {
  // @todo would this be better as a generator?
  const total = capacity - 1;
  return Array.from({ length: capacity }, (_, i) => total - i) as Entity[];
}

function entityValidator(capacity: number): (entity: Entity) => entity is Entity {
  /** @return `true` if the given entity is valid for the given capacity */
  return function isValidEntity(entity: Entity): entity is Entity {
    if (!isUint32(entity) || entity > capacity) return false;
    return true;
  };
}

/** Manages the creation, destruction and recycling of entities */
export function createEntityManager(spec: EntityManagerSpec): EntityManager {
  const { capacity } = spec;

  const entityArchetypes = createEntityArchetypeArray(capacity);
  const availableEntities = createAvailableEntityArray(capacity);
  const isValidEntity = entityValidator(capacity);

  return {
    /** @returns the next available Entity or `undefined` if no Entity is available */
    createEntity(): Entity | undefined {
      return availableEntities.pop();
    },

    /**
     * Remove and recycle an Entity
     * @returns `true` if there was an archetype change
     */
    destroyEntity(entity: Entity): boolean {
      if (!isValidEntity(entity)) return false;
      const archetype = entityArchetypes[entity];
      if (archetype !== undefined) {
        removeEntityFromArchetype(entity)(archetype);
        delete entityArchetypes[entity];
        availableEntities.push(entity);
        return true;
      }
      return false;
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

    isValidEntity,

    /** @returns `true` if the Archetype was changed successfully */
    setEntityArchetype(entity: Entity, archetype: Archetype): boolean {
      if (isValidEntity(entity)) {
        entityArchetypes[entity] = archetype;
        return true;
      }
      return false;
    },
  };
}
