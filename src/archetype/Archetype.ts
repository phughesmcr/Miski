/**
 * @module      Archetype
 * @description An Archetype is a collection of ComponentInstances which define the schema of an Entity.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { ID_KEY } from "../constants.ts";
import { isQueryMatch } from "../query/Query.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { Entity, QueryInstance } from "../types.ts";

/** An Archetype is a collection of ComponentInstances which define the schema of an Entity. */
export class Archetype {
  /** QueryInstances and their candidacy status */
  #candidateCache: Map<QueryInstance, boolean>;

  /** Entities which have entered this archetype since last refresh */
  #entered: BooleanArray;

  /** Set of Entities which inhabit this Archetype */
  #entities: BooleanArray;

  /** Entities which have exited this archetype since last refresh */
  #exited: BooleanArray;

  /** The world's entity capacity (used for entity tracking arrays) */
  #entityCapacity: number;

  /** The Archetype's Component Bitfield */
  readonly bitfield: BooleanArray;

  /** The components associated with this archetype */
  readonly components: ComponentInstance<any>[];

  /** The Archetype's unique identifier */
  readonly id: string;

  /**
   * Creates a new Archetype
   * @param capacity - The maximum number of entities in the world (world capacity)
   * @param components - The components associated with this Archetype
   * @param bitfield - Optional BooleanArray to use as the Archetype's Component Bitfield
   * @returns a new Archetype object
   */
  constructor(
    capacity: number,
    components: ComponentInstance<any>[],
    bitfield?: BooleanArray,
  ) {
    this.#entityCapacity = capacity;
    bitfield = bitfield ??
      (components.length > 0
        ? BooleanArray.fromObjects(components.length, ID_KEY, components)
        : new BooleanArray(capacity));
    this.bitfield = bitfield;
    this.id = bitfield.buffer.toString();
    this.components = components;
    this.#candidateCache = new Map();
    this.#entered = new BooleanArray(capacity);
    this.#entities = new BooleanArray(capacity);
    this.#exited = new BooleanArray(capacity);
  }

  /** The maximum id number of the components this Archetype can represent */
  get capacity(): number {
    return this.bitfield.size;
  }

  /** The world's entity capacity */
  get entityCapacity(): number {
    return this.#entityCapacity;
  }

  /**
   * Add an Entity to the Archetype
   * @param entity - The Entity to add
   * @returns The Archetype with the Entity added
   */
  addEntity(entity: Entity): Archetype {
    if (this.#entities.get(entity)) return this;
    this.#entities.set(entity, true);
    this.#entered.set(entity, true);
    return this;
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
    return this.#entities.getTruthyCount();
  }

  /**
   * Get an iterator of Entities which have entered this Archetype since it's last refresh
   * @returns An iterator of Entities which have entered the Archetype
   */
  getEntered(): IterableIterator<Entity> {
    return this.#entered.truthyIndices() as IterableIterator<Entity>;
  }

  /**
   * Get an iterator of Entities which inhabit this Archetype
   * @returns An iterator of Entities which inhabit the Archetype
   */
  getEntities(): IterableIterator<Entity> {
    return this.#entities.truthyIndices() as IterableIterator<Entity>;
  }

  /**
   * An iterator of Entities which have exited this Archetype since it's last refresh
   * @returns An iterator of Entities which have exited the Archetype
   */
  getExited(): IterableIterator<Entity> {
    return this.#exited.truthyIndices() as IterableIterator<Entity>;
  }

  /**
   * Test this Archetype matches a given QueryInstance
   * @param query - The QueryInstance to test
   * @returns `true` if the QueryInstance is a match, `false` otherwise
   */
  isCandidate = (query: QueryInstance): boolean => {
    const cached = this.#candidateCache.get(query);
    if (cached !== undefined) return cached;

    const result = isQueryMatch(this.bitfield, query);
    this.#candidateCache.set(query, result);
    return result;
  };

  /**
   * Check if this Archetype has entities which have entered/exited since last refresh
   * @returns `true` if this Archetype is dirty, `false` otherwise
   */
  isDirty(): boolean {
    return this.#entered.getTruthyCount() > 0 || this.#exited.getTruthyCount() > 0;
  }

  /**
   * Check if a given Archetype has no entities associated with it
   * @returns `true` if this Archetype is empty
   */
  isEmpty(): boolean {
    return this.#entities.getTruthyCount() === 0;
  }

  /**
   * Clear entered/exited entities from a given Archetype
   * @returns The refreshed Archetype
   */
  refresh(): Archetype {
    this.#entered.clear();
    this.#exited.clear();
    return this;
  }

  /**
   * Remove an Entity from an Archetype
   * @param entity - The Entity to remove
   * @returns The Archetype with the Entity removed
   */
  removeEntity(entity: Entity): Archetype {
    if (!this.#entities.get(entity)) return this;
    this.#entered.set(entity, false);
    this.#entities.set(entity, false);
    this.#exited.set(entity, true);
    return this;
  }

  /**
   * Serialize the Archetype to a string
   * @returns The serialized Archetype
   */
  stringify(): string {
    return JSON.stringify(
      {
        id: this.id,
        components: this.components.map((instance) => instance.id),
        entities: [...this.#entities.values()],
      },
    );
  }
}
