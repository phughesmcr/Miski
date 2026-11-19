import { ArgumentError, EntityNotFoundError, formatEntityNotActive, SpecError } from "@/errors.ts";
import {
  asSlotIndex,
  createEntityArray,
  type Entity,
  ENTITY_GEN_MASK,
  entityGeneration,
  entityIndex,
  isEntityInRange,
  MAX_WORLD_CAPACITY,
  packEntity,
  type SlotIndex,
} from "@/entity/entity.ts";
import { EntityIteratorPool } from "@/entity/pooled-entity-iterator.ts";
import { SlotAllocator } from "@/entity/slot-allocator.ts";
import { isUint32 } from "@/utils.ts";

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

  /** Per-call active entity iterators; each owns its packed handle buffer, grown on demand and kept for reuse. */
  readonly #activeIterators = new EntityIteratorPool(true);

  readonly #capacity: number;

  /**
   * Create a new EntityManager
   * @param capacity - The maximum number of entities allowed in the pool (inclusive)
   * @throws {SpecError} - If the capacity is not a positive integer no greater than {@link EntityManager.MAX_CAPACITY}
   */
  constructor(capacity: number) {
    if (isUint32(capacity) === false) {
      throw new SpecError("EntityManager capacity must be a number (uint32)");
    }
    if (capacity <= 0 || capacity > EntityManager.MAX_CAPACITY) {
      throw new SpecError(
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
   * @returns a pooled per-call iterator over a snapshot of the active packed entities taken now; nested calls each
   * get their own cursor and buffer
   * @param startSlot - Inclusive raw slot lower bound (default 0)
   * @param endSlot - Exclusive raw slot upper bound (default capacity)
   * @throws {ArgumentError} - If either bound is not an integer
   */
  getActive(
    startSlot: SlotIndex = asSlotIndex(0),
    endSlot: SlotIndex = asSlotIndex(this.#capacity),
  ): IterableIterator<Entity> {
    if (!Number.isInteger(startSlot) || !Number.isInteger(endSlot)) {
      throw new ArgumentError(`Active entity bounds must be integer slot indices (got ${startSlot}, ${endSlot}).`);
    }
    // Buffers are sized to the live population (an upper bound on any range), doubling up to capacity.
    const occupied = this.#slots.occupiedCount;
    let slots = this.#activeSlots;
    if (slots === undefined || slots.length < occupied) {
      slots = new Uint32Array(this.#growActiveLength(slots?.length ?? 0, occupied));
      this.#activeSlots = slots;
    }
    const iterator = this.#activeIterators.acquire();
    let entities = iterator.indices;
    if (entities.length < occupied) {
      entities = createEntityArray(this.#capacity, this.#growActiveLength(entities.length, occupied));
    }
    const count = this.#slots.occupiedIndicesInto(slots, startSlot, endSlot);
    for (let i = 0; i < count; i++) {
      const slot = slots[i]!;
      entities[i] = packEntity(slot, this.#generation[slot]!);
    }
    return iterator.open(entities, count);
  }

  /** Next length for a {@link getActive} buffer of `length` that must hold `needed` entries. */
  #growActiveLength(length: number, needed: number): number {
    return Math.min(this.#capacity, Math.max(needed, length * 2, 8));
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
    if (!isEntityInRange(entity, this.#capacity)) return false;
    const slot = entityIndex(entity);
    if (!this.#slots.isOccupied(slot)) return false;
    return this.generationAt(slot) === entityGeneration(entity);
  }

  /** Allocation cursor: the slot where the next acquisition starts searching. @internal */
  get allocationCursor(): number {
    return this.#slots.cursor;
  }

  /** Live occupancy bitmap words; read-only by contract. @internal */
  get occupancyWords(): Uint32Array {
    return this.#slots.words;
  }

  /** Live per-slot generations (unmasked); read-only by contract. @internal */
  get generations(): Uint32Array {
    return this.#generation;
  }

  /** Live per-slot next allocation generations (unmasked); read-only by contract. @internal */
  get nextGenerations(): Uint32Array {
    return this.#nextGeneration;
  }

  /**
   * Replace identity state with a validated world save.
   * Free slots always hold their next generation, so only live slots need a separate generation.
   * @param occupancy - Occupancy bitmap words
   * @param cursor - Allocation cursor
   * @param nextGeneration - Next allocation generation of every slot
   * @param liveGeneration - Generations of occupied slots, in ascending slot order
   * @internal
   */
  restoreSaved(
    occupancy: Uint32Array,
    cursor: number,
    nextGeneration: Uint32Array,
    liveGeneration: Uint32Array,
  ): void {
    this.#slots.restore(occupancy, cursor);
    this.#nextGeneration.set(nextGeneration);
    const generation = this.#generation;
    generation.set(nextGeneration);
    let count = 0;
    for (let word = 0; word < occupancy.length; word++) {
      let bits = occupancy[word]!;
      while (bits !== 0) {
        const slot = (word << 5) + (31 - Math.clz32(bits & -bits));
        generation[slot] = liveGeneration[count++]!;
        bits &= bits - 1;
      }
    }
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
