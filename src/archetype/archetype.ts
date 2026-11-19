import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "@/constants.ts";
import {
  createEntityArray,
  createSlotArray,
  type Entity,
  type EntityArray,
  packEntity,
  type PackSlot,
} from "@/entity/entity.ts";
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
  #slotList: EntityArray;

  /**
   * Packed handles parallel to {@link #slotList}, so query refills copy instead of re-packing.
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
    this.#slotList = createSlotArray(capacity, Math.min(capacity, INITIAL_LIST_LENGTH));
    this.#handleList = createEntityArray(this.#slotList.length);
    this.#positions = positions;
    this.#populationCount = 0;
    this.#transitionCapacity = Math.max(transitionCapacity, bitfield.size ?? 0, components.length);
    this.addTransitions = new Array(this.#transitionCapacity);
    this.removeTransitions = new Array(this.#transitionCapacity);
  }

  /**
   * Grow the dense list so it can hold `length` entries.
   * @internal
   */
  reserve(length: number): void {
    if (length <= this.#slotList.length) return;
    let next = this.#slotList.length * 2;
    while (next < length) next *= 2;
    const grown = Math.min(next, this.#entityCapacity);
    const expanded = createSlotArray(this.#entityCapacity, grown);
    expanded.set(this.#slotList.subarray(0, this.#populationCount));
    this.#slotList = expanded;
    const handles = createEntityArray(grown);
    handles.set(this.#handleList.subarray(0, this.#populationCount));
    this.#handleList = handles;
  }

  /**
   * Whether a storage slot currently inhabits this archetype.
   * Positions are shared across a world's archetypes, so a slot belongs here only if this list points back at it.
   */
  hasSlot(slot: number): boolean {
    const position = this.#positions[slot]!;
    return position < this.#populationCount && this.#slotList[position] === slot;
  }

  /**
   * Add a storage slot the caller has already validated as a live entity's slot (no-op if already here).
   * @internal
   */
  addSlot(slot: number): void {
    if (this.hasSlot(slot)) return;
    const position = this.#populationCount;
    if (position === this.#slotList.length) this.reserve(position + 1);
    this.#slotList[position] = slot;
    this.#handleList[position] = this.#packSlot(slot);
    this.#positions[slot] = position;
    this.#populationCount = position + 1;
    this.stamp = ++this.#clock.tick;
  }

  /**
   * Remove a storage slot (no-op if it is not here); the last slot takes its place.
   * @internal
   */
  removeSlot(slot: number): void {
    if (!this.hasSlot(slot)) return;
    const removeIndex = this.#positions[slot]!;
    const lastIndex = this.#populationCount - 1;
    if (removeIndex !== lastIndex) {
      const lastSlot = this.#slotList[lastIndex]!;
      this.#slotList[removeIndex] = lastSlot;
      this.#handleList[removeIndex] = this.#handleList[lastIndex]!;
      this.#positions[lastSlot] = removeIndex;
    }
    this.#populationCount = lastIndex;
    this.stamp = ++this.#clock.tick;
  }

  /**
   * The dense slot list in iteration order; only the first {@link getPopulationCount} entries are valid.
   * Growing replaces the array, so read it again after any population change.
   * @internal
   */
  get slotList(): EntityArray {
    return this.#slotList;
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
   * Get the number of entities currently associated with this Archetype
   * @returns The number of entities in the Archetype
   */
  getPopulationCount(): number {
    return this.#populationCount;
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
   * Copy the dense population in iteration order, for rollback.
   * @internal
   */
  capturePopulation(): EntityArray {
    return this.#slotList.slice(0, this.#populationCount);
  }

  /**
   * Replace the population with a captured dense list, preserving its iteration order.
   * @internal
   */
  restorePopulation(slots: EntityArray): void {
    this.#populationCount = 0;
    this.reserve(slots.length);
    this.#slotList.set(slots);
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
    const list = this.#slotList;
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
}
