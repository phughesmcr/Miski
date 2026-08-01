import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "@/constants.ts";
import { createSlotArray, type EntityArray, packEntity } from "@/entity/entity.ts";
import { asSlotIndex, type Entity, entityIndex, type PackSlot } from "@/entity/entity.ts";
import type { EntityResultSink } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance } from "@/types/query.ts";

const ENTERED_ACTIVE = 1 << 0;
const ENTERED_LISTED = 1 << 1;
const ENTITY_ACTIVE = 1 << 2;
const EXITED_ACTIVE = 1 << 4;
const EXITED_LISTED = 1 << 5;

function* activeSlotIterator(
  list: EntityArray,
  flags: Uint8Array,
  activeMask: number,
  count: number,
  packSlot: PackSlot,
): IterableIterator<Entity> {
  for (let i = 0; i < count; i++) {
    const slot = list[i]!;
    if (hasFlag(flags, slot, activeMask)) yield packSlot(slot);
  }
}

function hasFlag(flags: Uint8Array, slot: number, mask: number): boolean {
  return (flags[slot]! & mask) !== 0;
}

function setFlag(flags: Uint8Array, slot: number, mask: number, value: boolean): void {
  if (value) {
    flags[slot]! |= mask;
  } else {
    flags[slot]! &= ~mask;
  }
}

function isQueryMatch(target: BooleanArray, query: QueryInstance): boolean {
  if (!target.containsAll(query.and)) return false;
  if (target.intersects(query.not)) return false;
  return query.or.isEmpty() || target.intersects(query.or);
}

/** An Archetype is a collection of ComponentInstances which define the schema of an Entity. */
export class Archetype {
  /** QueryInstances and their candidacy status */
  #candidateCache: Map<QueryInstance, boolean>;

  /** Number of currently active entered entities */
  #enteredCount: number;

  /** Slots marked entered during this refresh window */
  #enteredList: EntityArray;

  /** Number of entries in the entered list */
  #enteredListCount: number;

  /** Number of currently active exited entities */
  #exitedCount: number;

  /** Slots marked exited during this refresh window */
  #exitedList: EntityArray;

  /** Number of entries in the exited list */
  #exitedListCount: number;

  /** The world's entity capacity (used for entity tracking arrays) */
  #entityCapacity: number;

  /** World component-registry size — transition edge arrays are indexed by instance id */
  #transitionCapacity: number;

  /** Dense currently-active storage slots in this archetype */
  #entityList: EntityArray;

  /** Dense entity-list positions indexed by storage slot */
  #entityPositions: EntityArray;

  /** Entity state flags packed by storage slot. */
  #flags: Uint8Array;

  /** Pack slot → entity at public / query edges */
  #packSlot: PackSlot;

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

  /** Cached remove-component transition edges by component instance id */
  readonly removeTransitions: Archetype[];

  /**
   * Creates a new Archetype
   * @param capacity - The maximum number of entities in the world (world capacity)
   * @param components - The components associated with this Archetype
   * @param bitfield - Optional BooleanArray to use as the Archetype's Component Bitfield
   * @param packSlot - Packs a live slot into an entity handle (defaults to generation 0)
   * @param transitionCapacity - Size of add/remove transition edge arrays (world component count)
   * @returns a new Archetype object
   */
  constructor(
    capacity: number,
    components: DynamicComponentInstance[],
    bitfield?: BooleanArray,
    packSlot: PackSlot = (slot) => packEntity(slot, 0),
    transitionCapacity: number = 0,
  ) {
    this.#entityCapacity = capacity;
    this.#packSlot = packSlot;
    bitfield = bitfield ??
      (components.length > 0 ?
        BooleanArray.fromObjects(components.length, ID_KEY, components) :
        new BooleanArray(Math.max(transitionCapacity, 1)));
    this.bitfield = bitfield;
    this.id = bitfield.buffer.toString();
    this.components = components;
    this.#candidateCache = new Map();
    this.#enteredCount = 0;
    this.#enteredList = createSlotArray(capacity);
    this.#enteredListCount = 0;
    this.#flags = new Uint8Array(capacity);
    this.#entityList = createSlotArray(capacity);
    this.#entityPositions = createSlotArray(capacity);
    this.#exitedCount = 0;
    this.#exitedList = createSlotArray(capacity);
    this.#exitedListCount = 0;
    this.#populationCount = 0;
    this.#transitionCapacity = Math.max(transitionCapacity, bitfield.size ?? 0, components.length);
    this.addTransitions = new Array(this.#transitionCapacity);
    this.removeTransitions = new Array(this.#transitionCapacity);
  }

  #activateEntity(slot: number): boolean {
    const flags = this.#flags;
    let flag = flags[slot]!;
    if ((flag & ENTITY_ACTIVE) !== 0) return false;

    const position = this.#populationCount;
    this.#entityList[position] = slot;
    this.#entityPositions[slot] = position;

    flag |= ENTITY_ACTIVE;
    if ((flag & ENTERED_ACTIVE) === 0) {
      if ((flag & ENTERED_LISTED) === 0) {
        flag |= ENTERED_LISTED;
        this.#enteredList[this.#enteredListCount++] = slot;
      }
      flag |= ENTERED_ACTIVE;
      this.#enteredCount++;
    }
    flags[slot] = flag;
    this.#populationCount++;
    return true;
  }

  #deactivateEntity(slot: number): boolean {
    const flags = this.#flags;
    let flag = flags[slot]!;
    if ((flag & ENTITY_ACTIVE) === 0) return false;

    if ((flag & ENTERED_ACTIVE) !== 0) {
      flag &= ~ENTERED_ACTIVE;
      this.#enteredCount--;
    }

    const removeIndex = this.#entityPositions[slot]!;
    const lastIndex = this.#populationCount - 1;
    const lastSlot = this.#entityList[lastIndex]!;
    if (removeIndex !== lastIndex) {
      this.#entityList[removeIndex] = lastSlot;
      this.#entityPositions[lastSlot] = removeIndex;
    }
    this.#entityList[lastIndex] = 0;
    this.#entityPositions[slot] = 0;

    flag &= ~ENTITY_ACTIVE;
    if ((flag & EXITED_ACTIVE) === 0) {
      if ((flag & EXITED_LISTED) === 0) {
        flag |= EXITED_LISTED;
        this.#exitedList[this.#exitedListCount++] = slot;
      }
      flag |= EXITED_ACTIVE;
      this.#exitedCount++;
    }
    flags[slot] = flag;
    this.#populationCount--;
    return true;
  }

  /**
   * Add an Entity to the Archetype
   * @param entity - The Entity to add
   * @param slot - Optional precomputed storage slot (`entityIndex(entity)`)
   * @returns The Archetype with the Entity added
   */
  addEntity(entity: Entity, slot: number = entityIndex(entity)): Archetype {
    this.#activateEntity(slot);
    return this;
  }

  /**
   * Add multiple storage slots to the archetype.
   * @param slots - Dense storage slots
   * @param start - First index to read
   * @param count - Number of slots to read
   * @returns The number of newly active entities
   */
  addEntities(slots: EntityArray, start: number, count: number): number {
    let added = 0;
    const end = start + count;
    for (let i = start; i < end; i++) {
      if (this.#activateEntity(slots[i]!)) added++;
    }
    return added;
  }

  /**
   * Create a new Archetype from an existing Archetype
   * @returns A new Archetype
   */
  clone(): Archetype {
    return new Archetype(
      this.#entityCapacity,
      this.components,
      this.bitfield.clone(),
      this.#packSlot,
      this.#transitionCapacity,
    );
  }

  /**
   * Get the number of entities currently associated with this Archetype
   * @returns The number of entities in the Archetype
   */
  getPopulationCount(): number {
    return this.#populationCount;
  }

  /**
   * Get an iterator of Entities which have entered this Archetype since it's last refresh
   * @returns An iterator of Entities which have entered the Archetype
   */
  getEntered(): IterableIterator<Entity> {
    return activeSlotIterator(
      this.#enteredList,
      this.#flags,
      ENTERED_ACTIVE,
      this.#enteredListCount,
      this.#packSlot,
    );
  }

  /**
   * Get an iterator of Entities which inhabit this Archetype
   * @returns An iterator of Entities which inhabit the Archetype
   */
  getEntities(): IterableIterator<Entity> {
    return activeSlotIterator(
      this.#entityList,
      this.#flags,
      ENTITY_ACTIVE,
      this.#populationCount,
      this.#packSlot,
    );
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
   * An iterator of Entities which have exited this Archetype since it's last refresh
   * @returns An iterator of Entities which have exited the Archetype
   */
  getExited(): IterableIterator<Entity> {
    return activeSlotIterator(
      this.#exitedList,
      this.#flags,
      EXITED_ACTIVE,
      this.#exitedListCount,
      this.#packSlot,
    );
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
   * Check if this Archetype has entities which have entered/exited since last refresh
   * @returns `true` if this Archetype is dirty, `false` otherwise
   */
  isDirty(): boolean {
    return this.#enteredCount > 0 || this.#exitedCount > 0;
  }

  /**
   * Check if a given Archetype has no entities associated with it
   * @returns `true` if this Archetype is empty
   */
  isEmpty(): boolean {
    return this.#populationCount === 0;
  }

  /**
   * Clear dense membership without removing the archetype from the registry.
   * @internal
   */
  clearPopulation(): void {
    this.#flags.fill(0);
    this.#entityList.fill(0);
    this.#entityPositions.fill(0);
    this.#enteredList.fill(0);
    this.#exitedList.fill(0);
    this.#populationCount = 0;
    this.#enteredCount = 0;
    this.#enteredListCount = 0;
    this.#exitedCount = 0;
    this.#exitedListCount = 0;
  }

  /**
   * Clear entered/exited entities from a given Archetype
   * @returns The refreshed Archetype
   */
  refresh(): Archetype {
    for (let i = 0; i < this.#enteredListCount; i++) {
      const slot = this.#enteredList[i]!;
      setFlag(this.#flags, slot, ENTERED_ACTIVE, false);
      setFlag(this.#flags, slot, ENTERED_LISTED, false);
    }
    for (let i = 0; i < this.#exitedListCount; i++) {
      const slot = this.#exitedList[i]!;
      setFlag(this.#flags, slot, EXITED_ACTIVE, false);
      setFlag(this.#flags, slot, EXITED_LISTED, false);
    }
    this.#enteredCount = 0;
    this.#enteredListCount = 0;
    this.#exitedCount = 0;
    this.#exitedListCount = 0;
    return this;
  }

  /**
   * Remove an Entity from an Archetype
   * @param entity - The Entity to remove
   * @param slot - Optional precomputed storage slot (`entityIndex(entity)`)
   * @returns The Archetype with the Entity removed
   */
  removeEntity(entity: Entity, slot: number = entityIndex(entity)): Archetype {
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
