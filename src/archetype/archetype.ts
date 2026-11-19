import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "@/constants.ts";
import { createEntityArray, createSlotArray, type EntityArray, packEntity } from "@/entity/entity.ts";
import { asSlotIndex, type Entity, entityIndex, type PackSlot } from "@/entity/entity.ts";
import { EntityNotFoundError, formatEntityNotActive } from "@/errors.ts";
import type { EntityResultSink } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance } from "@/types/query.ts";

function isQueryMatch(target: BooleanArray, query: QueryInstance): boolean {
  if (!target.containsAll(query.and)) return false;
  if (target.intersects(query.not)) return false;
  return query.or.isEmpty() || target.intersects(query.or);
}

/** Initial dense-list length; lists double on demand up to world capacity. */
const INITIAL_LIST_LENGTH = 16;

/**
 * A world's structural change clock. Every population change of one of the world's archetypes, and every change
 * to one of its query archetype lists, takes the next tick, so a value read from {@link tick} orders before every
 * later change in that world. Worlds have separate clocks, so a change in one world never makes another world's
 * retained query results look stale. It is never rewound, including by rollback or load, so a stamp can never be
 * mistaken for an older one.
 * @internal
 */
export class ArchetypeClock {
  /** The latest tick handed out. */
  tick: number = 0;

  /** Take a new tick. */
  next(): number {
    return ++this.tick;
  }
}

/**
 * An Archetype is a collection of ComponentInstances which define the schema of an Entity.
 *
 * Storage is proportional to population, not world capacity: the dense slot list grows on demand, and
 * slot-to-position lookups use a position table shared by every archetype of a world (an entity occupies
 * one archetype at a time). Entered/exited views are derived from the world's transition window.
 */
export class Archetype {
  /** QueryInstances and their candidacy status */
  #candidateCache: Map<QueryInstance, boolean>;

  /** The world's entity capacity */
  #entityCapacity: number;

  /** World component-registry size - transition edge arrays are indexed by instance id */
  #transitionCapacity: number;

  /** Dense currently-active storage slots in this archetype (grows on demand) */
  #entityList: EntityArray;

  /**
   * Packed handles parallel to {@link #entityList}, so query refills copy instead of re-packing.
   * A slot's generation only changes while it is outside every archetype (create packs before the slot joins one,
   * destroy leaves before the generation moves, rollback restores generations before populations), so a handle
   * packed when its slot joins stays current until the slot leaves.
   */
  #handleList: Uint32Array;

  /** Dense-list position indexed by storage slot; shared with sibling archetypes of the same world */
  #positions: EntityArray;

  /** Pack slot -> entity at public / query edges */
  #packSlot: PackSlot;

  /** The owning world's structural change clock */
  readonly #clock: ArchetypeClock;

  /** Number of entities currently associated with this archetype */
  #populationCount: number;

  /** The Archetype's Component Bitfield */
  readonly bitfield: BooleanArray;

  /** Cached add-component transition edges by component instance id */
  readonly addTransitions: Archetype[];

  /** The components associated with this archetype */
  readonly components: DynamicComponentInstance[];

  /** The Archetype's unique identifier */
  readonly id: string;

  /**
   * Creation order within its {@link ArchetypeManager}; query archetype lists stay sorted by it.
   * @internal
   */
  registryIndex: number = -1;

  /**
   * Queued for query-list insertion after becoming non-empty.
   * @internal
   */
  populatedPending: boolean = false;

  /**
   * Queued for query-list pruning after becoming empty.
   * @internal
   */
  emptiedPending: boolean = false;

  /**
   * {@link ArchetypeClock} tick of the last change to this archetype's population or its order.
   * Query results built after this tick still hold this archetype's entities in the right order.
   * @internal
   */
  stamp: number = 0;

  /**
   * Scratch group index used by batch moves; only meaningful while a batch move is grouping.
   * @internal
   */
  batchGroup: number = -1;

  /** Cached remove-component transition edges by component instance id */
  readonly removeTransitions: Archetype[];

  /**
   * Creates a new Archetype
   * @param capacity - The maximum number of entities in the world (world capacity)
   * @param components - The components associated with this Archetype
   * @param bitfield - Optional BooleanArray to use as the Archetype's Component Bitfield
   * @param packSlot - Packs a live slot into an entity handle (defaults to generation 0)
   * @param transitionCapacity - Size of add/remove transition edge arrays (world component count)
   * @param positions - Slot-to-position table shared by a world's archetypes (allocated when omitted)
   * @param clock - The owning world's structural change clock (a private clock when omitted)
   * @returns a new Archetype object
   */
  constructor(
    capacity: number,
    components: DynamicComponentInstance[],
    bitfield?: BooleanArray,
    packSlot: PackSlot = (slot) => packEntity(slot, 0),
    transitionCapacity: number = 0,
    positions: EntityArray = createSlotArray(capacity),
    clock: ArchetypeClock = new ArchetypeClock(),
  ) {
    this.#entityCapacity = capacity;
    this.#clock = clock;
    this.#packSlot = packSlot;
    if (bitfield === undefined) {
      // Component ids are world-registry positions, so size by the highest id rather than the count.
      let size = Math.max(transitionCapacity, 1);
      for (let i = 0; i < components.length; i++) size = Math.max(size, components[i]!.id + 1);
      bitfield = BooleanArray.fromObjects(size, ID_KEY, components);
    }
    this.bitfield = bitfield;
    this.id = bitfield.buffer.toString();
    this.components = components;
    this.#candidateCache = new Map();
    this.#entityList = createSlotArray(capacity, Math.min(capacity, INITIAL_LIST_LENGTH));
    this.#handleList = createEntityArray(capacity, this.#entityList.length);
    this.#positions = positions;
    this.#populationCount = 0;
    this.#transitionCapacity = Math.max(transitionCapacity, bitfield.size ?? 0, components.length);
    this.addTransitions = new Array(this.#transitionCapacity);
    this.removeTransitions = new Array(this.#transitionCapacity);
  }

  #requireEntitySlot(entity: Entity, slot: number): void {
    if (slot !== entityIndex(entity) || slot >= this.#entityCapacity || this.#packSlot(slot) !== entity) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
  }

  /**
   * Grow the dense list so it can hold `length` entries.
   * @internal
   */
  reserve(length: number): void {
    if (length <= this.#entityList.length) return;
    let next = this.#entityList.length * 2;
    while (next < length) next *= 2;
    const grown = Math.min(next, this.#entityCapacity);
    const expanded = createSlotArray(this.#entityCapacity, grown);
    expanded.set(this.#entityList.subarray(0, this.#populationCount));
    this.#entityList = expanded;
    const handles = createEntityArray(this.#entityCapacity, grown);
    handles.set(this.#handleList.subarray(0, this.#populationCount));
    this.#handleList = handles;
  }

  #activateEntity(slot: number): boolean {
    if (this.hasSlot(slot)) return false;
    const position = this.#populationCount;
    if (position === this.#entityList.length) this.reserve(position + 1);
    this.#entityList[position] = slot;
    this.#handleList[position] = this.#packSlot(slot);
    this.#positions[slot] = position;
    this.#populationCount = position + 1;
    this.stamp = ++this.#clock.tick;
    return true;
  }

  #deactivateEntity(slot: number): boolean {
    if (!this.hasSlot(slot)) return false;
    const removeIndex = this.#positions[slot]!;
    const lastIndex = this.#populationCount - 1;
    if (removeIndex !== lastIndex) {
      const lastSlot = this.#entityList[lastIndex]!;
      this.#entityList[removeIndex] = lastSlot;
      this.#handleList[removeIndex] = this.#handleList[lastIndex]!;
      this.#positions[lastSlot] = removeIndex;
    }
    this.#populationCount = lastIndex;
    this.stamp = ++this.#clock.tick;
    return true;
  }

  /**
   * Whether a storage slot currently inhabits this archetype.
   * Positions are shared across a world's archetypes, so a slot belongs here only if this list points back at it.
   */
  hasSlot(slot: number): boolean {
    const position = this.#positions[slot]!;
    return position < this.#populationCount && this.#entityList[position] === slot;
  }

  /**
   * Add an Entity to the Archetype
   * @param entity - The Entity to add
   * @param slot - Optional precomputed storage slot (`entityIndex(entity)`)
   * @returns The Archetype with the Entity added
   */
  addEntity(entity: Entity, slot: number = entityIndex(entity)): Archetype {
    this.#requireEntitySlot(entity, slot);
    this.#activateEntity(slot);
    return this;
  }

  /**
   * Add a storage slot the caller has already validated as a live entity's slot.
   * @internal
   */
  addSlot(slot: number): void {
    this.#activateEntity(slot);
  }

  /**
   * Remove a storage slot the caller has already validated as a live entity's slot.
   * @internal
   */
  removeSlot(slot: number): void {
    this.#deactivateEntity(slot);
  }

  /**
   * The dense slot list in iteration order; only the first {@link getPopulationCount} entries are valid.
   * Growing replaces the array, so read it again after any population change.
   * @internal
   */
  get slotList(): EntityArray {
    return this.#entityList;
  }

  /**
   * Packed handles parallel to {@link slotList}, under the same validity and growth rules.
   * @internal
   */
  get handleList(): Uint32Array {
    return this.#handleList;
  }

  /**
   * The packed handle of the entity at a dense-list position (`index < getPopulationCount()`).
   * @internal
   */
  entityAt(index: number): Entity {
    return this.#handleList[index]! as Entity;
  }

  /**
   * Add multiple storage slots to the archetype.
   * @param slots - Dense storage slots
   * @param start - First index to read
   * @param count - Number of slots to read
   * @returns The number of newly active entities
   */
  addEntities(slots: EntityArray, start: number, count: number): number {
    this.reserve(this.#populationCount + count);
    let added = 0;
    const end = start + count;
    for (let i = start; i < end; i++) {
      if (this.#activateEntity(slots[i]!)) added++;
    }
    return added;
  }

  /**
   * Get the number of entities currently associated with this Archetype
   * @returns The number of entities in the Archetype
   */
  getPopulationCount(): number {
    return this.#populationCount;
  }

  /**
   * Add this archetype's entities to a dense query result, optionally skipping entities already seen.
   * @param out - The destination dense result to update
   * @param visited - Optional bitfield used to deduplicate entities across archetypes
   * @returns The destination result
   */
  writeEntitiesIntoResult(out: EntityResultSink, visited?: BooleanArray): EntityResultSink {
    const packSlot = this.#packSlot;
    if (visited) {
      for (let i = 0; i < this.#populationCount; i++) {
        const slot = this.#entityList[i]!;
        if (visited.get(slot)) continue;
        out.add(packSlot(slot), asSlotIndex(slot));
        visited.set(slot, true);
      }
      return out;
    }

    for (let i = 0; i < this.#populationCount; i++) {
      const slot = this.#entityList[i]!;
      out.add(packSlot(slot), asSlotIndex(slot));
    }
    return out;
  }

  /**
   * Test this Archetype matches a given QueryInstance
   * @param query - The QueryInstance to test
   * @returns `true` if the QueryInstance is a match, `false` otherwise
   */
  isCandidate(query: QueryInstance): boolean {
    const cached = this.#candidateCache.get(query);
    if (cached !== undefined) return cached;

    const result = isQueryMatch(this.bitfield, query);
    this.#candidateCache.set(query, result);
    return result;
  }

  /**
   * Live dense population in iteration order; only the first {@link getPopulationCount} entries are valid.
   * @internal
   */
  get populationSlots(): EntityArray {
    return this.#entityList;
  }

  /**
   * Copy the dense population in iteration order, for rollback.
   * @internal
   */
  capturePopulation(): EntityArray {
    return this.#entityList.slice(0, this.#populationCount);
  }

  /**
   * Replace the population with a captured dense list, preserving its iteration order.
   * @internal
   */
  restorePopulation(slots: EntityArray): void {
    this.#populationCount = 0;
    this.reserve(slots.length);
    this.#entityList.set(slots);
    // Generations are restored first, so packing now yields the restored handles.
    const handles = this.#handleList;
    const packSlot = this.#packSlot;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      this.#positions[slot] = i;
      handles[i] = packSlot(slot);
    }
    this.#populationCount = slots.length;
    this.stamp = ++this.#clock.tick;
  }

  /**
   * Set `table[slot]` to `undefined` for every slot in this archetype's population.
   * @internal
   */
  forgetSlots(table: Array<Archetype | undefined>): void {
    const list = this.#entityList;
    for (let i = 0; i < this.#populationCount; i++) table[list[i]!] = undefined;
  }

  /**
   * Clear dense membership without removing the archetype from the registry.
   * @internal
   */
  clearPopulation(): void {
    this.#populationCount = 0;
    this.stamp = ++this.#clock.tick;
  }

  /**
   * Remove an Entity from an Archetype
   * @param entity - The Entity to remove
   * @param slot - Optional precomputed storage slot (`entityIndex(entity)`)
   * @returns The Archetype with the Entity removed
   */
  removeEntity(entity: Entity, slot: number = entityIndex(entity)): Archetype {
    this.#requireEntitySlot(entity, slot);
    this.#deactivateEntity(slot);
    return this;
  }

  /**
   * Remove multiple storage slots from the archetype.
   * @param slots - Dense storage slots
   * @param start - First index to read
   * @param count - Number of slots to read
   * @returns The number of entities that were active before removal
   */
  removeEntities(slots: EntityArray, start: number, count: number): number {
    let removed = 0;
    const end = start + count;
    for (let i = start; i < end; i++) {
      if (this.#deactivateEntity(slots[i]!)) removed++;
    }
    return removed;
  }
}
