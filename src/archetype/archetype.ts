/**
 * @module      Archetype
 * @description An Archetype is a collection of ComponentInstances which define the schema of an Entity.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { ComponentInstance } from "@/component/component-instance.ts";
import { isQueryMatch } from "@/query/query.ts";
import { ID_KEY } from "@/shared/constants.ts";
import { BooleanArray } from "@/shared/deps.ts";
import type { Entity, QueryInstance } from "@/shared/types.ts";

/**
 * Represents a set of components (encoded as a bitfield) that defines an Entity shape.
 * Tracks entity membership and entry/exit deltas between refresh cycles.
 *
 * @remarks
 * - `bitfield` encodes component presence by id; it is immutable for a given Archetype.
 * - `#entered`/`#exited` are cleared by {@link Archetype.refresh} and surface per-cycle deltas.
 * - `id` is derived from the bitfield buffer and uniquely identifies the Archetype in a world.
 */
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
   * Create an Archetype.
   * @param capacity - World entity capacity used to size internal tracking arrays.
   * @param components - Component instances included in this Archetype.
   * @param bitfield - Optional component bitfield; if omitted, one is derived from `components`.
   * @returns A new Archetype instance.
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
   * Add an Entity to this Archetype.
   * @param entity - The Entity to add.
   * @returns This Archetype.
   * @remarks Idempotent. Marks the entity as `entered` on first add within the current cycle.
   */
  addEntity(entity: Entity): Archetype {
    if (this.#entities.get(entity)) return this;
    this.#entities.set(entity, true);
    this.#entered.set(entity, true);
    return this;
  }

  /**
   * Create a new Archetype from this Archetype.
   * @returns A new Archetype.
   * @remarks The new Archetype reuses the same `components` array reference, clones the bitfield,
   * and starts with empty entity tracking arrays.
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
   * Test whether this Archetype satisfies a QueryInstance.
   * @param query - The QueryInstance to test.
   * @returns `true` if the QueryInstance is a match, `false` otherwise.
   * @remarks Results are cached per `query` instance for this Archetype.
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
   * Clear entered/exited deltas for this Archetype.
   * @returns This Archetype.
   * @remarks Does not modify current membership; only clears per-cycle deltas.
   */
  refresh(): Archetype {
    this.#entered.clear();
    this.#exited.clear();
    return this;
  }

  /**
   * Remove an Entity from this Archetype.
   * @param entity - The Entity to remove.
   * @returns This Archetype.
   * @remarks Idempotent. Marks the entity as `exited` on first remove within the current cycle.
   */
  removeEntity(entity: Entity): Archetype {
    if (!this.#entities.get(entity)) return this;
    this.#entered.set(entity, false);
    this.#entities.set(entity, false);
    this.#exited.set(entity, true);
    return this;
  }

  /**
   * Serialize this Archetype to JSON.
   * @returns The JSON string.
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
