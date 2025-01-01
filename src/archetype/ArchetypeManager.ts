/**
 * @module      ArchetypeManager
 * @description The ArchetypeManager is responsible for managing Archetypes and their associated Entities.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { Archetype } from "./Archetype.ts";
import { BooleanArray } from "@phughesmcr/booleanarray";
import { NotRegisteredError } from "../errors.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { Entity, QueryInstance } from "../types.ts";
import { ID_KEY } from "../constants.ts";

/** ArchetypeManager handles creation and allocation of Archetypes */
export class ArchetypeManager {
  /**
   * Create a new ArchetypeManager from a JSON string
   * @param json The JSON string
   * @returns a new ArchetypeManager
   */
  static fromJSON(json: string): ArchetypeManager {
    return new ArchetypeManager(JSON.parse(json));
  }

  /** Archetypes by their id */
  readonly registry: Map<string, Archetype>;

  /** Archetypes indexed by Entity */
  readonly entityArchetypes: Archetype[];

  /** Archetypes associated with a QueryInstance */
  readonly queryArchetypes: Map<QueryInstance, Set<Archetype>>;

  /**
   * The root/base archetype.
   *
   * Entities in this archetype have no components.
   */
  readonly root: Archetype;

  /**
   * @internal
   * Called by `world.init()`
   *
   * Initialize the ArchetypeManager
   * @returns this
   */
  init: () => this;

  /**
   * Update the Archetype associated with an Entity based on its components
   * @param entity The Entity
   * @param components The ComponentInstances
   * @returns The Archetype associated with the Entity
   */
  update: (entity: Entity, components: ComponentInstance<any>[]) => Archetype;

  /**
   * @internal
   * Create a new ArchetypeManager
   * @param capacity The maximum number of entities the manager can manage
   */
  constructor(capacity: number) {
    this.registry = new Map();
    this.entityArchetypes = new Array(capacity);
    this.queryArchetypes = new Map();

    this.root = new Archetype(capacity, []);
    this.registry.set(this.root.id, this.root);

    this.init = () => {
      this.entityArchetypes.length = capacity;
      for (let i = 0; i < capacity; i++) {
        this.entityArchetypes[i] = this.set(this.root, i);
      }
      return this;
    };

    this.update = (entity: Entity, components: ComponentInstance<any>[]): Archetype => {
      const currentArchetype: Archetype | undefined = this.fromEntity(entity);

      // Convert the components to a bitfield
      let nextBitfield: BooleanArray; // TODO: This could be pooled
      if (currentArchetype) {
        nextBitfield = currentArchetype.bitfield.clone();
        for (const component of components) {
          nextBitfield.toggleBool(component.id);
        }
      } else {
        nextBitfield = BooleanArray.fromObjects(capacity, ID_KEY, components);
      }

      // Check if the archetype has changed
      const nextId = nextBitfield.toString();
      if (nextId === currentArchetype?.id) {
        return currentArchetype;
      }

      // Remove the entity from the previous archetype
      if (currentArchetype !== undefined) {
        currentArchetype.removeEntity(entity);
      }

      // Get the existing archetype or create a new one
      const existing = this.registry.get(nextId);
      const nextArchetype = existing ?? new Archetype(capacity, [], nextBitfield);

      // Register the new archetype if it doesn't already exist
      if (this.registry.has(nextId) === false) {
        this.registry.set(nextId, nextArchetype);
      }

      // Update the entity's archetype
      this.set(nextArchetype, entity); // NOTE: this has to come after the registry is updated
      return nextArchetype;
    };
  }

  /**
   * @internal
   * Called by `world.destroy()`
   *
   * Destroy the ArchetypeManager
   * @returns this
   */
  destroy(): this {
    this.registry.clear();
    this.entityArchetypes.length = 0;
    this.queryArchetypes.clear();
    return this;
  }

  /**
   * Get the Archetype associated with an Entity
   * @param entity The Entity
   * @returns The Archetype associated with the Entity or undefined
   */
  fromEntity(entity: Entity): Archetype | undefined {
    return this.entityArchetypes[entity];
  }

  /**
   * Get the Archetypes associated with a QueryInstance
   * @param query The QueryInstance
   * @returns An IterableIterator of Archetypes associated with the QueryInstance or undefined
   */
  fromQuery(query: QueryInstance): IterableIterator<Archetype> | undefined {
    return this.queryArchetypes.get(query)?.values();
  }

  /**
   * Check if the ArchetypeManager manages an Archetype
   * @param archetype The Archetype
   * @returns `true` if the ArchetypeManager manages the Archetype, `false` otherwise
   */
  has(archetype: Archetype): boolean {
    return this.registry.has(archetype.id);
  }

  /**
   * Check if an Entity is in the root archetype
   * @param entity The Entity
   * @returns `true` if the Entity is in the root archetype, `false` otherwise
   */
  isInRoot(entity: Entity): boolean {
    return this.entityArchetypes[entity] === this.root;
  }

  /**
   * Run routine maintenance on the ArchetypeManager
   * @returns this
   */
  refresh(queries: IterableIterator<QueryInstance>): this {
    for (const archetype of this.registry.values()) {
      if (archetype.isEmpty() === false) {
        for (const instance of queries) {
          if (this.queryArchetypes.has(instance)) continue;
          if (archetype.isCandidate(instance) === false) continue;
          this.queryArchetypes.set(instance, new Set([archetype]));
        }
      }
      archetype.refresh();
    }
    return this;
  }

  /**
   * Reset an Entity to the root archetype
   * @param entity The Entity
   * @returns this
   */
  reset(entity: Entity): this {
    this.set(this.root, entity);
    return this;
  }

  /**
   * Set the Archetype associated with an Entity
   * @param archetype The Archetype
   * @param entity The Entity
   * @returns this
   * @throws {NotRegisteredError} If the Archetype is not registered
   */
  set(archetype: Archetype, entity: Entity): Archetype {
    if (this.has(archetype) === false) throw new NotRegisteredError("Invalid archetype.");
    if (this.entityArchetypes[entity] === archetype) return archetype;
    if (entity >= this.entityArchetypes.length || entity < 0) {
      throw new RangeError("Invalid entity.");
    }
    const current = this.entityArchetypes[entity]!;
    current.removeEntity(entity);
    this.entityArchetypes[entity] = archetype;
    archetype.addEntity(entity);
    return archetype;
  }

  /**
   * Stringify the ArchetypeManager
   * @returns The JSON string
   */
  stringify(): string {
    return JSON.stringify({
      registry: [...this.registry.values()].map((archetype) => archetype.stringify()),
      entityArchetypes: this.entityArchetypes,
      queryArchetypes: [...this.queryArchetypes.entries()].map(([query, archetypes]) => {
        return [query.id, [...archetypes].map((archetype) => archetype.id)];
      }),
    });
  }
}
