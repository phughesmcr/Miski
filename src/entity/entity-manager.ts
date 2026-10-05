import { BitPool } from "@phughesmcr/bitpool";
import { BooleanArray } from "@phughesmcr/booleanarray";

import { EntityNotFoundError, formatEntityNotActive } from "@/errors.ts";
import {
  asSlotIndex,
  createEntityArray,
  type Entity,
  ENTITY_GEN_MASK,
  entityGeneration,
  entityIndex,
  MAX_WORLD_CAPACITY,
  packEntity,
  ReusableEntityIterator,
  type SlotIndex,
} from "@/entity/entity.ts";
import type { EntityManagerSerialized } from "@/types/component.ts";
import { isPositiveUint32, isUint32, numberArrayFromString } from "@/utils.ts";

/** An EntityManager is responsible for creating and destroying entities */
export class EntityManager {
  /** The maximum capacity of any EntityManager */
  static readonly MAX_CAPACITY = MAX_WORLD_CAPACITY;

  /** The entity ID pool (raw slot occupancy) */
  pool: BitPool;

  /** Per-slot generation counters */
  readonly #generation: Uint32Array;

  /** Unmasked allocation generation; retained across rollback (handles wrap at 15 bits). */
  readonly #nextGeneration: Uint32Array;

  /** Scratch storage for active packed entity iteration */
  #activeEntities: Uint32Array;

  /** Scratch storage for occupied slot indices before packing */
  #activeSlots: Uint32Array;

  /** Reusable active entity iterator */
  #activeIterator: ReusableEntityIterator;

  readonly #capacity: number;

  /**
   * Create a new EntityManager from a JSON string
   * @param json - The JSON string matching {@link EntityManager.stringify} format
   * @returns A new EntityManager
   * @throws {RangeError} - If the `MAX_CAPACITY` does not match {@link EntityManager.MAX_CAPACITY}
   */
  static fromJSON(json: string): EntityManager {
    const parsed = JSON.parse(json) as EntityManagerSerialized & { generations?: string };
    const { MAX_CAPACITY, capacity, entities } = parsed;
    if (MAX_CAPACITY !== EntityManager.MAX_CAPACITY) {
      throw new RangeError(
        `EntityManager.MAX_CAPACITY mismatch: ${MAX_CAPACITY} !== ${EntityManager.MAX_CAPACITY}`,
      );
    }
    const arr = numberArrayFromString(entities);
    const pool = new BitPool(BooleanArray.fromUint32Array(capacity, arr));
    const manager = new EntityManager(capacity, pool);
    if (parsed.generations) {
      const gens = numberArrayFromString(parsed.generations);
      for (let i = 0; i < gens.length && i < capacity; i++) {
        manager.#generation[i] = gens[i]!;
        manager.#nextGeneration[i] = gens[i]! + (pool.isOccupied(i) ? 1 : 0);
      }
    }
    return manager;
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
    this.#capacity = capacity;
    this.pool = pool;
    this.#generation = new Uint32Array(capacity);
    this.#nextGeneration = new Uint32Array(capacity);
    for (let slot = 0; slot < capacity; slot++) {
      if (pool.isOccupied(slot)) this.#nextGeneration[slot] = 1;
    }
    this.#activeEntities = createEntityArray(capacity);
    this.#activeSlots = new Uint32Array(capacity);
    this.#activeIterator = new ReusableEntityIterator(this.#activeEntities);
  }

  /** @returns the maximum number of entities allowed in the pool (inclusive) */
  get capacity(): number {
    return this.#capacity;
  }

  /** Generation currently stored for a raw slot (masked on compare). */
  generationAt(slot: number): number {
    return this.#generation[slot]! & ENTITY_GEN_MASK;
  }

  /** Pack a live slot into an {@link Entity} handle. */
  packSlot(slot: number): Entity {
    return packEntity(slot, this.#generation[slot]!);
  }

  /**
   * Create a new entity
   * @returns The new packed {@link Entity}, or `undefined` if the pool is full
   */
  create(): Entity | undefined {
    const slot = this.pool.acquire();
    if (slot === -1) {
      return undefined;
    }
    const generation = this.#nextGeneration[slot]!;
    this.#generation[slot] = generation;
    this.#nextGeneration[slot] = (generation + 1) >>> 0;
    return packEntity(slot, generation);
  }

  /**
   * Destroy an entity
   * @param entity - The packed entity handle to destroy
   * @throws {EntityNotFoundError} - If the entity is not alive
   */
  destroy(entity: Entity): void {
    if (this.isActive(entity) === false) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    const slot = entityIndex(entity);
    this.pool.release(slot);
    // Generation is stored unmasked but compared via ENTITY_GEN_MASK on pack/isActive.
    this.#generation[slot] = this.#nextGeneration[slot]!;
  }

  /**
   * @returns an iterable of all active packed entities
   * @param startSlot - Inclusive raw slot lower bound (default 0)
   * @param endSlot - Exclusive raw slot upper bound (default capacity)
   */
  getActive(startSlot: number = 0, endSlot: number = this.#capacity): IterableIterator<Entity> {
    const count = this.pool.occupiedIndicesInto(this.#activeSlots, startSlot, endSlot);
    for (let i = 0; i < count; i++) {
      const slot = this.#activeSlots[i]!;
      this.#activeEntities[i] = packEntity(slot, this.#generation[slot]!);
    }
    return this.#activeIterator.reset(count);
  }

  /** @returns the number of active entities */
  getActiveCount(): number {
    return this.pool.occupiedCount;
  }

  /** @returns the number of available entities */
  getAvailableCount(): number {
    return this.#capacity - this.pool.occupiedCount;
  }

  /**
   * Check if an entity exists (live slot and matching generation)
   * @param entity - The packed entity handle to check
   * @returns `true` if the entity exists, `false` otherwise
   */
  isActive(entity: Entity): boolean {
    if (!this.isEntity(entity)) return false;
    const slot = entityIndex(entity);
    if (slot >= this.#capacity) return false;
    if (!this.pool.isOccupied(slot)) return false;
    return this.generationAt(slot) === entityGeneration(entity);
  }

  /**
   * Check if a value could be a valid packed handle for this pool's capacity
   * @param entity - The entity to check
   * @returns `true` if the slot index is in range
   */
  isEntity(entity: Entity): entity is Entity {
    if (!Number.isInteger(entity) || entity < 0 || entity > 0x7fffffff) return false;
    const slot = entityIndex(entity);
    return (slot === 0 || isPositiveUint32(slot)) && slot < this.#capacity;
  }

  /** Resolve a packed handle to its slot after validating liveness. */
  requireSlot(entity: Entity): SlotIndex {
    if (!this.isActive(entity)) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
    return asSlotIndex(entityIndex(entity));
  }

  /**
   * Serialize the entity manager to a JSON string
   * @returns a JSON string representation of the entity manager
   */
  stringify(): string {
    return JSON.stringify(
      {
        MAX_CAPACITY: EntityManager.MAX_CAPACITY,
        capacity: this.#capacity,
        entities: this.pool.toUint32Array().toString(),
        generations: Array.from(this.#generation).toString(),
      },
    );
  }

  /** Restore reversible identity state without reissuing speculative handles. */
  restoreJSON(json: string): void {
    const restored = EntityManager.fromJSON(json);
    if (restored.capacity !== this.#capacity) throw new RangeError("Entity capacity mismatch.");
    this.pool = restored.pool;
    this.#generation.set(restored.#generation);
    for (let slot = 0; slot < this.#capacity; slot++) {
      if (!this.pool.isOccupied(slot)) this.#generation[slot] = this.#nextGeneration[slot]!;
      this.#nextGeneration[slot] = Math.max(this.#nextGeneration[slot]!, restored.#nextGeneration[slot]!);
    }
  }
}
