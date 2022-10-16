/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { isUint32 } from "./utils/utils.js";
import type { Opaque } from "./utils/utils.js";
import { BitPool } from "./utils/bitpool.js";

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
export type Entity = Opaque<number, "Entity">;

export interface EntityManagerSpec {
  /** The maximum number of entities */
  capacity: number;
}

export class EntityManager {
  /** The maximum number of entities */
  capacity: number;

  /** Pool of Entity states */
  entityPool: BitPool;

  /**
   * Create a new EntityManager.
   *
   * EntityManagers manages the creation, destruction, and recycling of entities
   *
   * @param spec.capacity The maximum number of entities
   */
  constructor(spec: EntityManagerSpec) {
    const { capacity } = spec;
    this.capacity = capacity;
    this.entityPool = new BitPool(capacity);
  }

  /** @returns the next available entity or `undefined` if no entity is available */
  createEntity(): Entity | undefined {
    return this.entityPool.acquire() as Entity;
  }

  /**
   * Remove an entity and mark it as recyclable
   * @returns the inputted entity to aid chaining
   */
  destroyEntity(entity: Entity): Entity {
    /**
     * @todo
     * no difference between returned values on failure
     * consider letting the user know that the destruction
     * failed?
     */
    if (!this.isValidEntity(entity)) {
      throw new SyntaxError(`Could not destroy invalid entity "${entity}".`);
    };
    this.entityPool.release(entity);
    return entity;
  }

  /** @returns the number of available entities currently */
  getVacancies(): number {
    return this.entityPool.vacancies;
  }

  /** @return `true` if the given entity is valid for the given capacity */
  isValidEntity(entity: Entity): entity is Entity {
    return isUint32(entity) && entity < this.capacity;
  }
}
