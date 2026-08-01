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
import { ROLLBACK_PAGE_SIZE } from "@/rollback/page.ts";

export type EntityManagerRollbackState = {
  freeHead: number;
  nextFresh: number;
  liveCount: number;
  readonly occupiedPages: Array<Uint32Array | undefined>;
  readonly generationPages: Array<Uint32Array | undefined>;
  readonly capturedPages: number[];
  /** Full occupancy word snapshot taken lazily on first capture. */
  occupiedWords?: Uint32Array;
};

/** An EntityManager is responsible for creating and destroying entities */
export class EntityManager {
  /** The maximum capacity of any EntityManager */
  static readonly MAX_CAPACITY = MAX_WORLD_CAPACITY;

  /** The entity ID pool (raw slot occupancy) */
  pool: BitPool;

  /** Per-slot generation counters */
  readonly #generation: Uint32Array;

  /** Scratch storage for active packed entity iteration */
  #activeEntities: Uint32Array;

  /** Scratch storage for occupied slot indices before packing */
  #activeSlots: Uint32Array;

  /** Reusable active entity iterator */
  #activeIterator: ReusableEntityIterator;

  readonly #capacity: number;
  readonly #occupiedPagePool: Uint32Array[] = [];
  readonly #generationPagePool: Uint32Array[] = [];
  #rollbackStatePool: EntityManagerRollbackState | undefined;

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
    return packEntity(slot, this.#generation[slot]!);
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
    this.#generation[slot] = (this.#generation[slot]! + 1) >>> 0;
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

  /** @internal Begin a pooled entity rollback shell; pages fill lazily. */
  beginRollbackState(): EntityManagerRollbackState {
    const state = this.#rollbackStatePool ?? {
      freeHead: 0,
      nextFresh: 0,
      liveCount: 0,
      occupiedPages: [],
      generationPages: [],
      capturedPages: [],
    };
    this.#rollbackStatePool = undefined;
    state.liveCount = this.pool.occupiedCount;
    state.occupiedWords = undefined;
    return state;
  }

  /** @internal Capture the page containing `slot` once per rollback scope. */
  captureRollbackPage(state: EntityManagerRollbackState, slot: number): void {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.#capacity) {
      throw new TypeError("Invalid entity rollback page.");
    }
    const page = Math.floor(slot / ROLLBACK_PAGE_SIZE);
    if (state.generationPages[page] !== undefined) return;

    if (state.occupiedWords === undefined) {
      state.occupiedWords = this.pool.toUint32Array();
    }

    const start = page * ROLLBACK_PAGE_SIZE;
    const length = Math.min(ROLLBACK_PAGE_SIZE, this.#capacity - start);
    const aliveWord = start >>> 5;

    let occupied = this.#occupiedPagePool.pop();
    if (occupied === undefined || occupied.length !== 1) occupied = new Uint32Array(1);
    occupied[0] = state.occupiedWords[aliveWord]!;

    let generation = this.#generationPagePool.pop();
    if (generation === undefined || generation.length !== length) generation = new Uint32Array(length);
    generation.set(this.#generation.subarray(start, start + length));

    state.occupiedPages[page] = occupied;
    state.generationPages[page] = generation;
    state.capturedPages.push(page);
  }

  /** @internal Validate before any rollback owner mutates live state. */
  validateRollbackState(state: EntityManagerRollbackState): void {
    if (state.liveCount < 0 || state.liveCount > this.#capacity) {
      throw new TypeError("Invalid entity rollback state.");
    }
    for (let index = 0; index < state.capturedPages.length; index++) {
      const page = state.capturedPages[index]!;
      const start = page * ROLLBACK_PAGE_SIZE;
      const length = Math.min(ROLLBACK_PAGE_SIZE, this.#capacity - start);
      const occupied = state.occupiedPages[page];
      const generation = state.generationPages[page];
      if (
        !Number.isSafeInteger(page) || page < 0 || start >= this.#capacity ||
        occupied === undefined || occupied.length !== 1 ||
        generation === undefined || generation.length !== length
      ) {
        throw new TypeError("Invalid entity rollback state.");
      }
    }
  }

  /** @internal Restore occupancy and generations for captured pages. */
  restoreRollbackState(state: EntityManagerRollbackState): void {
    const words = this.pool.toUint32Array();
    for (let index = 0; index < state.capturedPages.length; index++) {
      const page = state.capturedPages[index]!;
      const start = page * ROLLBACK_PAGE_SIZE;
      const length = Math.min(ROLLBACK_PAGE_SIZE, this.#capacity - start);
      const aliveWord = start >>> 5;
      const capturedAliveWord = state.occupiedPages[page]![0]!;
      const capturedGeneration = state.generationPages[page]!;

      for (let offset = 0; offset < length; offset++) {
        const slot = start + offset;
        const capturedAlive = (capturedAliveWord & (1 << (slot & 31))) !== 0;
        if (capturedAlive) {
          this.#generation[slot] = capturedGeneration[offset]!;
        } else if (this.pool.isOccupied(slot)) {
          // Invalidate handles issued for slots that were dead at capture time.
          this.#generation[slot] = (this.#generation[slot]! + 1) >>> 0;
        }
      }

      words[aliveWord] = capturedAliveWord;
    }
    this.pool = new BitPool(BooleanArray.fromUint32Array(this.#capacity, Array.from(words)));
  }

  /** @internal Return page buffers to the pool after commit or restore. */
  releaseRollbackState(state: EntityManagerRollbackState): void {
    for (let index = 0; index < state.capturedPages.length; index++) {
      const page = state.capturedPages[index]!;
      this.#occupiedPagePool.push(state.occupiedPages[page]!);
      this.#generationPagePool.push(state.generationPages[page]!);
      state.occupiedPages[page] = undefined;
      state.generationPages[page] = undefined;
    }
    state.capturedPages.length = 0;
    state.occupiedWords = undefined;
    this.#rollbackStatePool = state;
  }
}
