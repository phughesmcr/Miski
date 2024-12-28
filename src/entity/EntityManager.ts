/**
 * @module    EntityManager
 * @description A simple entity manager for managing entities in a game or simulation
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license   MIT
 */

import { BitPool } from "@phughesmcr/bitpool";

/** An Entity is essentially just an ID number / pointer */
export type Entity = number;

/**
 * Convert a string representation of a number array to an array of numbers
 * @param str The string representation of the number array
 * @returns The array of numbers
 */
function numberArrayFromString(str: string): number[] {
  return str
    .replaceAll(/[\[\]]/g, "")
    .split(",")
    .map((n) => parseInt(n, 10));
}

/**
 * An EntityManager is a simple entity manager for managing entities in a game or simulation
 */
export class EntityManager {
  /** The entity ID pool */
  #pool: BitPool;

  /**
   * Create a new EntityManager from a JSON string
   * @param json The JSON string matching {@link EntityManager.toJSON} format
   * @returns A new EntityManager
   */
  static fromJSON(json: string): EntityManager {
    const { capacity, entities } = JSON.parse(json);
    const arr = numberArrayFromString(entities);
    const pool = BitPool.fromArray(arr, capacity);
    return new EntityManager(capacity, pool);
  }

  /**
   * Create a new EntityManager
   * @param capacity The maximum number of entities allowed in the pool (inclusive)
   */
  constructor(capacity: number, pool: BitPool = new BitPool(capacity)) {
    if (typeof capacity !== "number" || !isNaN(capacity)) {
      throw new TypeError("EntityManager capacity must be a positive integer");
    }
    if (capacity <= 0 || capacity > BitPool.MAX_SAFE_SIZE) {
      throw new RangeError("EntityManager capacity must be a positive integer");
    }
    this.#pool = pool;
  }

  /** @returns the maximum number of entities allowed in the pool (inclusive) */
  get capacity(): number {
    return this.#pool.size;
  }

  /** @returns the number of active entities */
  getActiveCount(): number {
    const size = this.capacity;
    const population = this.#pool.getPopulationCount();
    const active = size - population;
    return active > this.capacity ? this.capacity : active;
  }

  /** @returns the number of available entities */
  getVacancyCount(): number {
    return this.capacity - this.getActiveCount();
  }

  /**
   * Check if an entity is valid for this pool
   * @param entity The entity to check
   * @returns `true` if the entity is valid, `false` otherwise
   * @see EntityManager.exists to check if an entity is valid and resident
   */
  isEntity(entity: Entity): entity is Entity {
    if (typeof entity !== "number" || isNaN(entity) || !Number.isSafeInteger(entity)) {
      return false;
    }
    if (entity < 0 || entity > 4294967295) {
      return false;
    }
    if (entity > this.capacity) {
      return false;
    }
    return true;
  }

  /**
   * Check if an entity exists (i.e., is valid && is active)
   * @param entity The entity to check
   * @returns `true` if the entity exists, `false` otherwise
   */
  exists(entity: Entity): boolean {
    return this.isEntity(entity) && this.#pool.isOccupied(entity);
  }

  /**
   * Create a new entity
   * @returns The new `Entity`, or `undefined` if the pool is full
   */
  create(): Entity | undefined {
    const entity = this.#pool.acquire() as Entity;
    if (entity === -1) {
      return undefined;
    }
    return entity;
  }

  /**
   * Destroy an entity
   * @param entity The entity to destroy
   * @returns `true` if the entity was destroyed successfully, `false` otherwise
   */
  destroy(entity: Entity): boolean {
    if (!this.isEntity(entity)) {
      return false;
    }
    this.#pool.release(entity);
    return true;
  }

  /**
   * Serialize the entity manager to a JSON string
   * @returns a JSON string representation of the entity manager
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify|MDN}
   */
  stringify(): string {
    return JSON.stringify(
      {
        capacity: this.#pool.size,
        entities: this.#pool.toString(),
      },
    );
  }
}
