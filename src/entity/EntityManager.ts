/**
 * @module      EntityManager
 * @description A simple entity manager for managing entities in a game or simulation
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BitPool } from "@phughesmcr/bitpool";
import { EntityNotFoundError } from "../errors.ts";
import { isPositiveUint32, isUint32, numberArrayFromString } from "../utils.ts";
import type { Entity, EntityManagerSerialized } from "../types.ts";

/** An EntityManager is responsible for creating and destroying entities */
export class EntityManager {
  /** The maximum capacity of any EntityManager */
  static readonly MAX_CAPACITY = BitPool.MAX_SAFE_SIZE;

  /** The entity ID pool */
  pool: BitPool;

  /** @returns an iterable of all active entities */
  getActive: (startEntity?: Entity, endEntity?: Entity) => IterableIterator<Entity>;

  /**
   * Create a new EntityManager from a JSON string
   * @param json - The JSON string matching {@link EntityManager.stringify} format
   * @returns A new EntityManager
   * @throws {RangeError} - If the `MAX_CAPACITY` does not match {@link EntityManager.MAX_CAPACITY}
   */
  static fromJSON(json: string): EntityManager {
    const { MAX_CAPACITY, capacity, entities } = JSON.parse(json) as EntityManagerSerialized;
    if (MAX_CAPACITY !== EntityManager.MAX_CAPACITY) {
      throw new RangeError(
        `EntityManager.MAX_CAPACITY mismatch: ${MAX_CAPACITY} !== ${EntityManager.MAX_CAPACITY}`,
      );
    }
    const arr = numberArrayFromString(entities);
    const pool = BitPool.fromArray(capacity, arr);
    return new EntityManager(capacity, pool);
  }

  /**
   * Create a new EntityManager
   * @param capacity - The maximum number of entities allowed in the pool (inclusive)
   * @param pool - The pool to use for entity management
   * @throws {TypeError} - If the capacity is not a Uint32 number
   * @throws {RangeError} - If the capacity is not a positive integer or above 0 and below {@link EntityManager.MAX_CAPACITY}
   */
  constructor(capacity: number, pool: BitPool = new BitPool(capacity)) {
    if (isUint32(capacity) === false) {
      throw new TypeError("EntityManager capacity must be a number (uint32)");
    }
    if (capacity <= 0 || capacity > EntityManager.MAX_CAPACITY) {
      throw new RangeError(
        `EntityManager capacity must be a positive integer, above 0 and below ${EntityManager.MAX_CAPACITY}`,
      );
    }
    this.pool = pool;
    this.getActive = this.pool.occupiedIndices.bind(this.pool);
  }

  /** @returns the maximum number of entities allowed in the pool (inclusive) */
  get capacity(): number {
    return this.pool.size;
  }

  /**
   * Create a new entity
   * @returns The new `Entity`, or `undefined` if the pool is full
   */
  create = (): Entity | undefined => {
    const entity = this.pool.acquire() as Entity;
    if (entity === -1) {
      return undefined;
    }
    return entity;
  };

  /**
   * Destroy an entity
   * @param entity - The entity to destroy
   * @throws {EntityNotFoundError} - If the entity is not found
   */
  destroy = (entity: Entity): void => {
    if (this.isEntity(entity) === false) {
      throw new EntityNotFoundError(entity);
    }
    this.pool.release(entity);
  };

  /** @returns the number of active entities */
  getActiveCount = (): number => {
    return this.pool.occupiedCount;
  };

  /** @returns the number of available entities */
  getAvailableCount = (): number => {
    return this.capacity - this.pool.occupiedCount;
  };

  /**
   * Check if an entity exists (i.e., is valid && is active)
   * @param entity - The entity to check
   * @returns `true` if the entity exists, `false` otherwise
   */
  isActive = (entity: Entity): boolean => {
    return this.isEntity(entity) && this.pool.isOccupied(entity);
  };

  /**
   * Check if an entity is valid for this pool
   * @param entity - The entity to check
   * @returns `true` if the entity is valid, `false` otherwise
   * @see EntityManager.exists to check if an entity is valid and resident
   */
  isEntity = (entity: Entity): entity is Entity => {
    return (entity === 0 || isPositiveUint32(entity)) && entity < this.capacity;
  };

  /**
   * Serialize the entity manager to a JSON string
   * @returns a JSON string representation of the entity manager
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify|MDN}
   */
  stringify = (): string => {
    return JSON.stringify(
      {
        MAX_CAPACITY: EntityManager.MAX_CAPACITY,
        capacity: this.pool.size,
        entities: this.pool.toString(),
      },
    );
  };
}
