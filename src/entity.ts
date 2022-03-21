/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Archetype } from "./archetype/archetype.js";
import { createAvailabilityArray, isUint32, Opaque } from "./utils/utils.js";

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
export type Entity = Opaque<number, "Entity">;

interface EntityManagerSpec {
  capacity: number;
  EMPTY_ARCHETYPE: Archetype;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  removeEntityFromArchetype: (entity: Entity, archetype: Archetype) => Archetype;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => Archetype;
}

interface EntityManager {
  createEntity: () => Entity | undefined;
  destroyEntity: (entity: Entity) => boolean;
  getVacancyCount: () => number;
  hasEntity: (entity: Entity) => boolean;
  isValidEntity: (entity: Entity) => entity is Entity;
}

/** Type-guard for Entity */
function entityValidator(capacity: number): (entity: Entity) => entity is Entity {
  /** @return `true` if the given entity is valid for the given capacity */
  return function isValidEntity(entity: Entity): entity is Entity {
    return isUint32(entity) && entity <= capacity;
  };
}

/** Manages the creation, destruction and recycling of entities */
export function createEntityManager(spec: EntityManagerSpec): EntityManager {
  const { capacity, EMPTY_ARCHETYPE, getEntityArchetype, removeEntityFromArchetype, setEntityArchetype } = spec;

  const availableEntities = createAvailabilityArray(capacity) as Entity[];
  const isValidEntity = entityValidator(capacity);

  return {
    /** @returns the next available Entity or `undefined` if no Entity is available */
    createEntity(): Entity | undefined {
      const entity = availableEntities.pop();
      if (entity !== undefined) setEntityArchetype(entity, EMPTY_ARCHETYPE);
      return entity;
    },

    /**
     * Remove and recycle an Entity
     * @returns `true` if there was an archetype change
     */
    destroyEntity(entity: Entity): boolean {
      if (!isValidEntity(entity)) return false;
      const archetype = getEntityArchetype(entity);
      if (!archetype) return false;
      removeEntityFromArchetype(entity, archetype);
      availableEntities.push(entity);
      return true;
    },

    /** @returns the number of available entities */
    getVacancyCount() {
      return availableEntities.length;
    },

    /** @return `true` if the Entity !== undefined */
    hasEntity(entity: Entity): boolean {
      return isValidEntity(entity) && getEntityArchetype(entity) !== undefined;
    },

    isValidEntity,
  };
}
