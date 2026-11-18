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
import { SlotAllocator } from "@/entity/slot-allocator.ts";
import type { EntityManagerSerialized } from "@/types/component.ts";
import { isUint32, numberArrayFromString } from "@/utils.ts";

/** An EntityManager is responsible for creating and destroying entities */
export class EntityManager {
  /** The maximum capacity of any EntityManager */
  static readonly MAX_CAPACITY = MAX_WORLD_CAPACITY;

  /** Raw slot occupancy and next-fit allocation cursor */
  readonly #slots: SlotAllocator;

  /** Per-slot generation counters */
  readonly #generation: Uint32Array;

  /** Unmasked allocation generation; retained across rollback (handles wrap at 15 bits). */
  readonly #nextGeneration: Uint32Array;

  /** Scratch storage for occupied slot indices before packing (allocated by {@link getActive}, grown on demand) */
  #activeSlots: Uint32Array | undefined;

  /** Reusable active entity iterator over packed handles (allocated with `#activeSlots`) */
  #activeIterator: ReusableEntityIterator | undefined;

  readonly #capacity: number;

  /**
   * Create a new EntityManager from a JSON string
   * @param json - The JSON string matching {@link EntityManager.stringify} format
   * @returns A new EntityManager
   * @throws {RangeError} - If the `MAX_CAPACITY` does not match {@link EntityManager.MAX_CAPACITY}
   */
  static fromJSON(json: string): EntityManager {
    const parsed = JSON.parse(json) as EntityManagerSerialized;
    const { MAX_CAPACITY, capacity, entities } = parsed;
    if (MAX_CAPACITY !== EntityManager.MAX_CAPACITY) {
      throw new RangeError(
        `EntityManager.MAX_CAPACITY mismatch: ${MAX_CAPACITY} !== ${EntityManager.MAX_CAPACITY}`,
      );
    }
    const manager = new EntityManager(capacity);
    const slots = manager.#slots;
    // A missing cursor (older format) meant "lowest free slot", which a search from slot 0 reproduces.
    slots.restore(numberArrayFromString(entities), typeof parsed.cursor === "number" ? parsed.cursor : 0);
    for (let slot = 0; slot < capacity; slot++) {
      if (slots.isOccupied(slot)) manager.#nextGeneration[slot] = 1;
    }
    if (parsed.generations) {
      const gens = numberArrayFromString(parsed.generations);
      for (let i = 0; i < gens.length && i < capacity; i++) {
        manager.#generation[i] = gens[i]!;
        manager.#nextGeneration[i] = gens[i]! + (slots.isOccupied(i) ? 1 : 0);
      }
    }
    return manager;
  }

  /**
   * Create a new EntityManager
   * @param capacity - The maximum number of entities allowed in the pool (inclusive)
   * @throws {TypeError} - If the capacity is not a Uint32 number
   * @throws {RangeError} - If the capacity is not a positive integer or above 0 and below {@link EntityManager.MAX_CAPACITY}
   */
  constructor(capacity: number) {
    if (isUint32(capacity) === false) {
      throw new TypeError("EntityManager capacity must be a number (uint32)");
    }
    if (capacity <= 0 || capacity > EntityManager.MAX_CAPACITY) {
      throw new RangeError(
        `EntityManager capacity must be a positive integer, above 0 and below ${EntityManager.MAX_CAPACITY}`,
      );
    }
    this.#capacity = capacity;
    this.#slots = new SlotAllocator(capacity);
    this.#generation = new Uint32Array(capacity);
    this.#nextGeneration = new Uint32Array(capacity);
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
   * Create a new entity.
   * Slots are reused next-fit (see {@link SlotAllocator}): a freed slot is reissued only after the allocator has swept
   * past every other free slot, so handle generations wrap only after about 32,768 x (free slots) creations.
   * @returns The new packed {@link Entity}, or `undefined` if the pool is full
   */
  create(): Entity | undefined {
    const slot = this.#slots.acquire();
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
    this.#slots.release(slot);
    // Generation is stored unmasked but compared via ENTITY_GEN_MASK on pack/isActive.
    this.#generation[slot] = this.#nextGeneration[slot]!;
  }

  /**
   * @returns an iterable of all active packed entities
   * @param startSlot - Inclusive raw slot lower bound (default 0)
   * @param endSlot - Exclusive raw slot upper bound (default capacity)
   * @throws {TypeError} - If either bound is not an integer
   */
  getActive(
    startSlot: SlotIndex = asSlotIndex(0),
    endSlot: SlotIndex = asSlotIndex(this.#capacity),
  ): IterableIterator<Entity> {
    if (!Number.isInteger(startSlot) || !Number.isInteger(endSlot)) {
      throw new TypeError(`Active entity bounds must be integer slot indices (got ${startSlot}, ${endSlot}).`);
    }
    // Scratch is sized to the live population (an upper bound on any range), doubling up to capacity.
    const occupied = this.#slots.occupiedCount;
    let slots = this.#activeSlots;
    let iterator = this.#activeIterator;
    if (slots === undefined || iterator === undefined || slots.length < occupied) {
      const length = Math.min(this.#capacity, Math.max(occupied, (slots?.length ?? 8) * 2));
      slots = new Uint32Array(length);
      const entities = createEntityArray(this.#capacity, length);
      if (iterator === undefined) iterator = new ReusableEntityIterator(entities);
      else iterator.indices = entities;
      this.#activeSlots = slots;
      this.#activeIterator = iterator;
    }
    const entities = iterator.indices;
    const count = this.#slots.occupiedIndicesInto(slots, startSlot, endSlot);
    for (let i = 0; i < count; i++) {
      const slot = slots[i]!;
      entities[i] = packEntity(slot, this.#generation[slot]!);
    }
    return iterator.reset(count);
  }

  /** @returns the number of active entities */
  getActiveCount(): number {
    return this.#slots.occupiedCount;
  }

  /** @returns the number of available entities */
  getAvailableCount(): number {
    return this.#capacity - this.#slots.occupiedCount;
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
    if (!this.#slots.isOccupied(slot)) return false;
    return this.generationAt(slot) === entityGeneration(entity);
  }

  /**
   * Check if a value could be a valid packed handle for this pool's capacity
   * @param entity - The entity to check
   * @returns `true` if the slot index is in range
   */
  isEntity(entity: Entity): entity is Entity {
    if (!Number.isInteger(entity) || entity < 0 || entity > 0x7fffffff) return false;
    return entityIndex(entity) < this.#capacity;
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
        entities: this.#slots.toUint32Array().toString(),
        cursor: this.#slots.cursor,
        generations: Array.from(this.#generation).toString(),
      },
    );
  }

  /**
   * Capture reversible identity state: occupancy, the pool's allocation cursor, and the generations of live slots.
   * Free slots need no generation: restore retires them at their (monotonic) next generation.
   */
  captureState(): EntityManagerState {
    const occupancy = this.#slots.toUint32Array();
    const generation = new Uint32Array(this.#slots.occupiedCount);
    let count = 0;
    for (let word = 0; word < occupancy.length; word++) {
      let bits = occupancy[word]!;
      while (bits !== 0) {
        const slot = (word << 5) + (31 - Math.clz32(bits & -bits));
        generation[count++] = this.#generation[slot]!;
        bits &= bits - 1;
      }
    }
    return { occupancy, cursor: this.#slots.cursor, generation };
  }

  /**
   * Restore state from {@link captureState} without reissuing speculative handles.
   * Allocation order after restore matches a manager that never left the captured state.
   */
  restoreState(state: EntityManagerState): void {
    this.#slots.restore(state.occupancy, state.cursor);
    // Handles issued after capture stay retired: generations only move forward, so every slot that was free at
    // capture is parked at its next generation, and only slots live at capture take their captured generation.
    const generation = this.#generation;
    const nextGeneration = this.#nextGeneration;
    generation.set(nextGeneration);
    const occupancy = state.occupancy;
    const captured = state.generation;
    let count = 0;
    for (let word = 0; word < occupancy.length; word++) {
      let bits = occupancy[word]!;
      while (bits !== 0) {
        const slot = (word << 5) + (31 - Math.clz32(bits & -bits));
        const gen = captured[count++]!;
        generation[slot] = gen;
        if (nextGeneration[slot]! < gen + 1) nextGeneration[slot] = gen + 1;
        bits &= bits - 1;
      }
    }
  }
}

/** Reversible {@link EntityManager} state captured for rollback. */
export type EntityManagerState = {
  readonly occupancy: Uint32Array;
  readonly cursor: number;
  /** Generations of slots occupied at capture, in ascending slot order. */
  readonly generation: Uint32Array;
};
