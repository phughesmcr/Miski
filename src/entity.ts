/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { createAvailabilityArray, isUint32, Opaque } from "./utils/utils.js";

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
export type Entity = Opaque<number, "Entity">;

export interface EntityManagerSpec {
  /** The maximum number of entities */
  capacity: number;
}

export class EntityManager {
  /** The maximum number of entities */
  capacity: number;

  /** Pool of currently available entities */
  entityPool: Entity[];

  /**
   * Create a new EntityManager.
   *
   * EntityManagers manages the creation, destruction, and recycling of entities
   *
   * @param capacity The maximum number of entities
   */
  constructor(spec: EntityManagerSpec) {
    const { capacity } = spec;
    this.capacity = capacity;
    this.entityPool = createAvailabilityArray(capacity) as Entity[];
  }

  /** @returns the next available entity or `undefined` if no entity is available */
  createEntity(): Entity | undefined {
    return this.entityPool.pop();
  }

  /**
   * Remove an entity and mark it as recyclable
   * @returns the inputted entity to aid chaining
   */
  destroyEntity(entity: Entity): Entity {
    this.entityPool.push(entity);
    return entity;
  }

  /** @returns the number of available entities */
  getVacancies(): number {
    return this.entityPool.length;
  }

  /** @return `true` if the given entity is valid for the given capacity */
  isValidEntity(entity: Entity): entity is Entity {
    return isUint32(entity) && entity <= this.capacity;
  }
}
