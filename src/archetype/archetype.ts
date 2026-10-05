import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "@/constants.ts";
import { createEntityArray, createSlotArray, type EntityArray, packEntity } from "@/entity/entity.ts";
import { asSlotIndex, type Entity, entityIndex, type PackSlot } from "@/entity/entity.ts";
import { EntityNotFoundError, formatEntityNotActive } from "@/errors.ts";
import type { EntityResultSink } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance } from "@/types/query.ts";

const ENTERED_ACTIVE = 1 << 0;
const ENTERED_LISTED = 1 << 1;
const ENTITY_ACTIVE = 1 << 2;
const EXITED_LISTED = 1 << 5;

/** Walk the slots listed as entered this window that are still entered (not since departed). */
function* enteredSlotIterator(
  list: EntityArray,
  flags: Uint8Array,
  count: number,
  packSlot: PackSlot,
): IterableIterator<Entity> {
  for (let i = 0; i < count; i++) {
    const slot = list[i]!;
    if (hasFlag(flags, slot, ENTERED_ACTIVE)) yield packSlot(slot);
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

  /** Packed historical handles departed during this refresh window. */
  #exitedList: Uint32Array;

  readonly #lastExitedEntities: Uint32Array;

  /** Number of entries in the exited list */
  #exitedListCount: number;

  /** The world's entity capacity (used for entity tracking arrays) */
  #entityCapacity: number;

  /** World component-registry size - transition edge arrays are indexed by instance id */
  #transitionCapacity: number;

  /** Dense currently-active storage slots in this archetype */
  #entityList: EntityArray;

  /** Dense entity-list positions indexed by storage slot */
  #entityPositions: EntityArray;

  /** Entity state flags packed by storage slot. */
  #flags: Uint8Array;

  /** Pack slot -> entity at public / query edges */
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
    this.#enteredCount = 0;
    this.#enteredList = createSlotArray(capacity);
    this.#enteredListCount = 0;
    this.#flags = new Uint8Array(capacity);
    this.#entityList = createSlotArray(capacity);
    this.#entityPositions = createSlotArray(capacity);
    this.#exitedList = createEntityArray(capacity);
    this.#lastExitedEntities = createEntityArray(capacity);
    this.#exitedListCount = 0;
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

  #appendExited(entity: Entity): void {
    if (this.#exitedListCount === this.#exitedList.length) {
      const expanded = createEntityArray(this.#entityCapacity, this.#exitedList.length * 2);
      expanded.set(this.#exitedList);
      this.#exitedList = expanded;
    }
    this.#exitedList[this.#exitedListCount++] = entity;
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
    const entity = this.#packSlot(slot);
    if ((flag & EXITED_LISTED) === 0 || this.#lastExitedEntities[slot] !== entity) {
      this.#appendExited(entity);
      flag |= EXITED_LISTED;
      this.#lastExitedEntities[slot] = entity;
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
    this.#requireEntitySlot(entity, slot);
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
    return enteredSlotIterator(this.#enteredList, this.#flags, this.#enteredListCount, this.#packSlot);
  }

  /**
   * Get an iterator of Entities which inhabit this Archetype
   * @returns An iterator of Entities which inhabit the Archetype
   */
  *getEntities(): IterableIterator<Entity> {
    for (let i = 0; i < this.#populationCount; i++) {
      yield this.#packSlot(this.#entityList[i]!);
    }
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
  *getExited(): IterableIterator<Entity> {
    for (let index = 0; index < this.#exitedListCount; index++) {
      yield this.#exitedList[index]! as Entity;
    }
  }

  /** Snapshot the transition window independently from reversible population. */
  captureTransitions(): { entered: Entity[]; exited: Entity[] } {
    return { entered: [...this.getEntered()], exited: [...this.getExited()] };
  }

  /** Restore the window captured before speculative mutations. */
  restoreTransitions(state: { entered: Entity[]; exited: Entity[] }): void {
    this.refresh();
    for (const entity of state.entered) {
      const slot = entityIndex(entity);
      this.#enteredList[this.#enteredListCount++] = slot;
      setFlag(this.#flags, slot, ENTERED_LISTED | ENTERED_ACTIVE, true);
      this.#enteredCount++;
    }
    for (const entity of state.exited) {
      this.#appendExited(entity);
      const slot = entityIndex(entity);
      this.#lastExitedEntities[slot] = entity;
      setFlag(this.#flags, slot, EXITED_LISTED, true);
    }
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
    return this.#enteredCount > 0 || this.#exitedListCount > 0;
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
    this.#lastExitedEntities.fill(0);
    this.#populationCount = 0;
    this.#enteredCount = 0;
    this.#enteredListCount = 0;
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
    for (let index = 0; index < this.#exitedListCount; index++) {
      setFlag(this.#flags, entityIndex(this.#exitedList[index]!), EXITED_LISTED, false);
    }
    this.#enteredCount = 0;
    this.#enteredListCount = 0;
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
