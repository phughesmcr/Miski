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

/** ArchetypeManager handles creation and allocation of Archetypes */
export class ArchetypeManager {
  /** Archetypes by their id */
  readonly registry: Map<string, Archetype>;

  /** Archetypes indexed by Entity */
  readonly entityArchetypes: Archetype[];

  /** Archetypes associated with a QueryInstance */
  readonly queryArchetypes: Map<QueryInstance, Set<Archetype>>;

  /** Entities in this archetype have no components */
  readonly root: Archetype;

  /** The number of components registered in the world */
  #componentCount: number = 0;

  /**
   * Create a new ArchetypeManager
   * @param capacity - The maximum number of entities this manager can handle
   * @param componentCount - The number of components registered in the world
   */
  constructor(capacity: number, componentCount: number) {
    this.registry = new Map();
    this.entityArchetypes = new Array(capacity);
    this.queryArchetypes = new Map();
    this.#componentCount = componentCount;

    // Create root archetype with properly sized bitfield for components
    const rootBitfield = new BooleanArray(componentCount);
    this.root = new Archetype(capacity, [], rootBitfield);
    this.registry.set(this.root.id, this.root);

    // Created here to avoid dependency on providing `capacity`
    this.init = () => {
      this.entityArchetypes.length = capacity;
      for (let i = 0; i < capacity; i++) {
        this.entityArchetypes[i] = this.set(this.root, i);
      }
      return this;
    };

    // Created here to avoid dependency on providing `capacity` and `componentCount`
    this.update = (() => {
      const bitfield = new BooleanArray(this.#componentCount);

      return (entity: Entity, components: ComponentInstance<any>[]): Archetype => {
        const oldArchetype = this.entityArchetypes[entity];

        // Reset and update bitfield
        bitfield.clear();
        for (let i = 0; i < components.length; i++) {
          bitfield.set(components[i]!.id, true);
        }

        // Get or create archetype for these components
        const archetypeId = bitfield.buffer.toString();
        if (oldArchetype?.id === archetypeId) return oldArchetype;

        let archetype = this.registry.get(archetypeId);
        if (!archetype) {
          archetype = new Archetype(capacity, components, bitfield.clone());
          this.registry.set(archetypeId, archetype);
        }

        // Move entity to new archetype
        oldArchetype?.removeEntity(entity);
        archetype.addEntity(entity);
        this.entityArchetypes[entity] = archetype;

        return archetype;
      };
    })();
  }

  /**
   * Get the components associated with an entity
   * @param entity - The entity to get the components for
   * @returns A record of component instances
   */
  getEntityComponents = (() => {
    const componentCache: Record<string, ComponentInstance<any>> = {};

    return (entity: Entity): Readonly<Record<string, ComponentInstance<any>>> => {
      // Clear cache
      for (const key in componentCache) {
        delete componentCache[key];
      }

      const archetype = this.entityArchetypes[entity];
      if (!archetype) return componentCache;

      // Reuse cache object
      const components = archetype.components;
      const len = components.length;
      for (let i = 0; i < len; i++) {
        const component = components[i];
        if (component) {
          componentCache[component.name] = component;
        }
      }
      return componentCache;
    };
  })();

  /**
   * Called by `world.destroy()`
   *
   * Destroy the ArchetypeManager
   * @returns this
   */
  destroy = (): this => {
    this.registry.clear();
    this.entityArchetypes.length = 0;
    this.queryArchetypes.clear();
    return this;
  };

  /**
   * Get the Archetype associated with an Entity
   * @param entity The Entity
   * @returns The Archetype associated with the Entity or undefined
   */
  getEntityArchetype(entity: Entity): Archetype | undefined {
    return this.entityArchetypes[entity];
  }

  /**
   * Called by `world.init()`
   *
   * Initialize the ArchetypeManager
   * @returns this
   */
  init: () => this;

  /**
   * Check if the ArchetypeManager manages an Archetype
   * @param archetype The Archetype
   * @returns `true` if the ArchetypeManager manages the Archetype, `false` otherwise
   */
  has = (archetype: Archetype): boolean => {
    return this.registry.has(archetype.id);
  };

  /**
   * Check if an Entity is in the root archetype
   * @param entity The Entity
   * @returns `true` if the Entity is in the root archetype, `false` otherwise
   */
  isEntityInRoot = (entity: Entity): boolean => {
    return this.entityArchetypes[entity] === this.root;
  };

  /**
   * Get the Archetypes associated with a QueryInstance
   * @param query The QueryInstance
   * @returns An IterableIterator of Archetypes associated with the QueryInstance or undefined
   */
  query = (query: QueryInstance): IterableIterator<Archetype> | undefined => {
    return this.queryArchetypes.get(query)?.values();
  };

  /**
   * Run routine maintenance on the ArchetypeManager
   * @returns this
   */
  refresh = (queries: MapIterator<QueryInstance>): this => {
    // Clear existing query archetype mappings
    this.queryArchetypes.clear();

    // Convert queries iterator to array to avoid exhaustion
    const queryArray = [...queries];

    // Initialize query archetype sets
    for (const query of queryArray) {
      this.queryArchetypes.set(query, new Set());
      query.archetypes.clear(); // Clear the QueryInstance's archetypes set
    }

    // For each archetype
    for (const archetype of this.registry.values()) {
      // Check against each query
      for (const query of queryArray) {
        if (archetype.isCandidate(query)) {
          const archetypeSet = this.queryArchetypes.get(query)!;
          // Only add if it has entities TODO: is this right?
          if (archetype.getPopulationCount() > 0) {
            archetypeSet.add(archetype);
            query.archetypes.add(archetype); // Update the QueryInstance's archetypes set
          }
        }
      }
      archetype.refresh();
    }
    return this;
  };

  /**
   * Reset an Entity to the root archetype
   * @param entity The Entity
   * @returns this
   */
  reset = (entity: Entity): this => {
    this.set(this.root, entity);
    return this;
  };

  /**
   * Set the Archetype associated with an Entity
   * @param archetype The Archetype
   * @param entity The Entity
   * @returns this
   * @throws {NotRegisteredError} If the Archetype is not registered
   */
  set = (archetype: Archetype, entity: Entity): Archetype => {
    if (!this.registry.has(archetype.id)) {
      throw new NotRegisteredError("Invalid archetype.");
    }
    if (entity >= this.entityArchetypes.length || entity < 0) {
      throw new RangeError("Invalid entity.");
    }

    const currentArchetype = this.entityArchetypes[entity];
    if (currentArchetype === archetype) return archetype;

    currentArchetype?.removeEntity(entity);
    this.entityArchetypes[entity] = archetype;
    archetype.addEntity(entity);
    return archetype;
  };

  /**
   * Stringify the ArchetypeManager
   * @returns The JSON string
   */
  stringify = (): string => {
    return JSON.stringify({
      registry: [...this.registry.values()].map((archetype) => archetype.stringify()),
      entityArchetypes: this.entityArchetypes,
      queryArchetypes: [...this.queryArchetypes.entries()].map(([query, archetypes]) => {
        return [query.id, [...archetypes].map((archetype) => archetype.id)];
      }),
    });
  };

  /**
   * @internal
   * Update the Archetype associated with an Entity based on its components
   * @param entity The Entity
   * @param components The ComponentInstances
   * @returns The Archetype associated with the Entity
   */
  update: (entity: Entity, components: ComponentInstance<any>[]) => Archetype;
}
