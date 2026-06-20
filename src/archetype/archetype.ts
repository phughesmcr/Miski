/**
 * @module      Archetype
 * @description An Archetype is a collection of ComponentInstances which define the schema of an Entity.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "@/constants.ts";
import { createEntityArray, type EntityArray } from "@/entity/entity-array.ts";
import { isQueryMatch } from "@/query/query.ts";
import type { QueryEntityResult } from "@/query/query-pool.ts";
import type { DynamicComponentInstance, Entity, QueryInstance } from "@/types.ts";

const ENTERED_ACTIVE = 1 << 0;
const ENTERED_LISTED = 1 << 1;
const ENTITY_ACTIVE = 1 << 2;
const ENTITY_LISTED = 1 << 3;
const EXITED_ACTIVE = 1 << 4;
const EXITED_LISTED = 1 << 5;

function* activeListIterator(
  list: EntityArray,
  flags: Uint8Array,
  activeMask: number,
  count: number,
): IterableIterator<Entity> {
  for (let i = 0; i < count; i++) {
    const entity = list[i]!;
    if (hasFlag(flags, entity, activeMask)) yield entity;
  }
}

function hasFlag(flags: Uint8Array, entity: Entity, mask: number): boolean {
  return (flags[entity]! & mask) !== 0;
}

function setFlag(flags: Uint8Array, entity: Entity, mask: number, value: boolean): void {
  if (value) {
    flags[entity]! |= mask;
  } else {
    flags[entity]! &= ~mask;
  }
}

/** An Archetype is a collection of ComponentInstances which define the schema of an Entity. */
export class Archetype {
  /** QueryInstances and their candidacy status */
  #candidateCache: Map<QueryInstance, boolean>;

  /** Number of currently active entered entities */
  #enteredCount: number;

  /** Entities that were marked entered during this refresh window */
  #enteredList: EntityArray;

  /** Number of entries in the entered list */
  #enteredListCount: number;

  /** Number of currently active exited entities */
  #exitedCount: number;

  /** Entities that were marked exited during this refresh window */
  #exitedList: EntityArray;

  /** Number of entries in the exited list */
  #exitedListCount: number;

  /** The world's entity capacity (used for entity tracking arrays) */
  #entityCapacity: number;

  /** Entities that have ever inhabited this archetype, in first-entry order */
  #entityList: EntityArray;

  /** Number of entries in the entity list */
  #entityListCount: number;

  /** Entity state flags packed by entity id. */
  #flags: Uint8Array;

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
   * @returns a new Archetype object
   */
  constructor(
    capacity: number,
    components: DynamicComponentInstance[],
    bitfield?: BooleanArray,
  ) {
    this.#entityCapacity = capacity;
    bitfield = bitfield ??
      (components.length > 0 ?
        BooleanArray.fromObjects(components.length, ID_KEY, components) :
        new BooleanArray(capacity));
    this.bitfield = bitfield;
    this.id = bitfield.buffer.toString();
    this.components = components;
    this.#candidateCache = new Map();
    this.#enteredCount = 0;
    this.#enteredList = createEntityArray(capacity);
    this.#enteredListCount = 0;
    this.#flags = new Uint8Array(capacity);
    this.#entityList = createEntityArray(capacity);
    this.#entityListCount = 0;
    this.#exitedCount = 0;
    this.#exitedList = createEntityArray(capacity);
    this.#exitedListCount = 0;
    this.#populationCount = 0;
    this.addTransitions = [];
    this.removeTransitions = [];
  }

  /** The maximum id number of the components this Archetype can represent */
  get capacity(): number {
    return this.bitfield.size;
  }

  /** The world's entity capacity */
  get entityCapacity(): number {
    return this.#entityCapacity;
  }

  #activateEntity(entity: Entity): boolean {
    if (hasFlag(this.#flags, entity, ENTITY_ACTIVE)) return false;
    if (!hasFlag(this.#flags, entity, ENTITY_LISTED)) {
      setFlag(this.#flags, entity, ENTITY_LISTED, true);
      this.#entityList[this.#entityListCount++] = entity;
    }
    setFlag(this.#flags, entity, ENTITY_ACTIVE, true);
    if (!hasFlag(this.#flags, entity, ENTERED_ACTIVE)) {
      if (!hasFlag(this.#flags, entity, ENTERED_LISTED)) {
        setFlag(this.#flags, entity, ENTERED_LISTED, true);
        this.#enteredList[this.#enteredListCount++] = entity;
      }
      setFlag(this.#flags, entity, ENTERED_ACTIVE, true);
      this.#enteredCount++;
    }
    this.#populationCount++;
    return true;
  }

  #deactivateEntity(entity: Entity): boolean {
    if (!hasFlag(this.#flags, entity, ENTITY_ACTIVE)) return false;
    if (hasFlag(this.#flags, entity, ENTERED_ACTIVE)) {
      setFlag(this.#flags, entity, ENTERED_ACTIVE, false);
      this.#enteredCount--;
    }
    setFlag(this.#flags, entity, ENTITY_ACTIVE, false);
    if (!hasFlag(this.#flags, entity, EXITED_ACTIVE)) {
      if (!hasFlag(this.#flags, entity, EXITED_LISTED)) {
        setFlag(this.#flags, entity, EXITED_LISTED, true);
        this.#exitedList[this.#exitedListCount++] = entity;
      }
      setFlag(this.#flags, entity, EXITED_ACTIVE, true);
      this.#exitedCount++;
    }
    this.#populationCount--;
    return true;
  }

  /**
   * Add an Entity to the Archetype
   * @param entity - The Entity to add
   * @returns The Archetype with the Entity added
   */
  addEntity(entity: Entity): Archetype {
    this.#activateEntity(entity);
    return this;
  }

  /**
   * Add multiple entities to the archetype.
   * @param entities - Dense entity IDs
   * @param start - First index to read
   * @param count - Number of entity IDs to read
   * @returns The number of newly active entities
   */
  addEntities(entities: EntityArray, start: number, count: number): number {
    let added = 0;
    const end = start + count;
    for (let i = start; i < end; i++) {
      const entity = entities[i]!;
      if (this.#activateEntity(entity)) added++;
    }
    return added;
  }

  /**
   * Create a new Archetype from an existing Archetype
   * @returns A new Archetype
   */
  clone(): Archetype {
    return new Archetype(this.#entityCapacity, this.components, this.bitfield.clone());
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
    return activeListIterator(this.#enteredList, this.#flags, ENTERED_ACTIVE, this.#enteredListCount);
  }

  /**
   * Get an iterator of Entities which inhabit this Archetype
   * @returns An iterator of Entities which inhabit the Archetype
   */
  getEntities(): IterableIterator<Entity> {
    return activeListIterator(this.#entityList, this.#flags, ENTITY_ACTIVE, this.#entityListCount);
  }

  /**
   * Add this archetype's entities to a dense query result, optionally skipping entities already seen.
   * @param out - The destination dense result to update
   * @param visited - Optional bitfield used to deduplicate entities across archetypes
   * @returns The destination result
   */
  writeEntitiesIntoResult(out: QueryEntityResult, visited?: BooleanArray): QueryEntityResult {
    if (visited) {
      for (let i = 0; i < this.#entityListCount; i++) {
        const entity = this.#entityList[i]!;
        if (!hasFlag(this.#flags, entity, ENTITY_ACTIVE)) continue;
        if (visited.get(entity)) continue;
        out.add(entity);
        visited.set(entity, true);
      }
      return out;
    }

    for (let i = 0; i < this.#entityListCount; i++) {
      const entity = this.#entityList[i]!;
      if (!hasFlag(this.#flags, entity, ENTITY_ACTIVE)) continue;
      out.add(entity);
    }
    return out;
  }

  /**
   * An iterator of Entities which have exited this Archetype since it's last refresh
   * @returns An iterator of Entities which have exited the Archetype
   */
  getExited(): IterableIterator<Entity> {
    return activeListIterator(this.#exitedList, this.#flags, EXITED_ACTIVE, this.#exitedListCount);
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
   * Clear entered/exited entities from a given Archetype
   * @returns The refreshed Archetype
   */
  refresh(): Archetype {
    for (let i = 0; i < this.#enteredListCount; i++) {
      const entity = this.#enteredList[i]!;
      setFlag(this.#flags, entity, ENTERED_ACTIVE, false);
      setFlag(this.#flags, entity, ENTERED_LISTED, false);
    }
    for (let i = 0; i < this.#exitedListCount; i++) {
      const entity = this.#exitedList[i]!;
      setFlag(this.#flags, entity, EXITED_ACTIVE, false);
      setFlag(this.#flags, entity, EXITED_LISTED, false);
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
   * @returns The Archetype with the Entity removed
   */
  removeEntity(entity: Entity): Archetype {
    this.#deactivateEntity(entity);
    return this;
  }

  /**
   * Remove multiple entities from the archetype.
   * @param entities - Dense entity IDs
   * @param start - First index to read
   * @param count - Number of entity IDs to read
   * @returns The number of entities that were active before removal
   */
  removeEntities(entities: EntityArray, start: number, count: number): number {
    let removed = 0;
    const end = start + count;
    for (let i = start; i < end; i++) {
      const entity = entities[i]!;
      if (this.#deactivateEntity(entity)) removed++;
    }
    return removed;
  }
}
