/**
 * @module      ArchetypeManager
 * @description The ArchetypeManager is responsible for managing Archetypes and their associated Entities.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";

import { ID_KEY } from "@/constants.ts";
import { NotRegisteredError } from "@/errors.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Entity, QueryInstance } from "@/types.ts";
import { Archetype } from "./archetype.ts";

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

  /** The maximum number of entities this manager can handle. */
  #capacity: number;

  /** Reusable cache for entity component lookup. */
  #componentCache: Record<string, ComponentInstance<any>>;

  /** Whether query-to-archetype mappings need to be rebuilt */
  #queryMembershipDirty: boolean;

  /** Reusable query list for refresh passes */
  #queryScratch: QueryInstance[];

  /** Reusable bitfield for full component-list archetype updates. */
  #updateBitfield: BooleanArray;

  /**
   * Move an entity to a
   * new archetype and mark query membership dirty.
   * @param entity - The entity to move
   * @param archetype - The target archetype
   * @returns The target archetype
   */
  #moveEntity(entity: Entity, archetype: Archetype): Archetype {
    const oldArchetype = this.entityArchetypes[entity];
    if (oldArchetype === archetype) return archetype;

    oldArchetype?.removeEntity(entity);
    archetype.addEntity(entity);
    this.entityArchetypes[entity] = archetype;
    this.#queryMembershipDirty = true;

    return archetype;
  }

  /**
   * Get or create the archetype reached by adding/removing one component.
   * @param from - The source archetype
   * @param instance - The component being added or removed
   * @param add - Whether the component is being added
   * @returns The target archetype
   */
  #getTransitionArchetype(from: Archetype, instance: ComponentInstance<any>, add: boolean): Archetype {
    const hasComponent = from.bitfield.get(instance.id);
    if (hasComponent === add) return from;

    const transitions = add ? from.addTransitions : from.removeTransitions;
    const cached = transitions[instance.id];
    if (cached) return cached;

    const bitfield = from.bitfield.clone();
    bitfield.set(instance.id, add);
    const archetypeId = bitfield.buffer.toString();
    let archetype = this.registry.get(archetypeId);

    if (!archetype) {
      const components = add
        ? this.#componentsWithAdded(from.components, instance)
        : this.#componentsWithRemoved(from.components, instance);
      archetype = new Archetype(this.entityArchetypes.length, components, bitfield);
      this.registry.set(archetypeId, archetype);
    }

    transitions[instance.id] = archetype;
    return archetype;
  }

  /**
   * Build a component list with one component inserted by registry id.
   * @param components - The source component list
   * @param instance - The component to insert
   * @returns A component list for the target archetype
   */
  #componentsWithAdded(
    components: readonly ComponentInstance<any>[],
    instance: ComponentInstance<any>,
  ): ComponentInstance<any>[] {
    const result = new Array<ComponentInstance<any>>(components.length + 1);
    let out = 0;
    let inserted = false;
    for (let i = 0; i < components.length; i++) {
      const component = components[i]!;
      if (!inserted && instance.id < component.id) {
        result[out++] = instance;
        inserted = true;
      }
      result[out++] = component;
    }
    if (!inserted) result[out] = instance;
    return result;
  }

  /**
   * Build a component list with one component removed.
   * @param components - The source component list
   * @param instance - The component to remove
   * @returns A component list for the target archetype
   */
  #componentsWithRemoved(
    components: readonly ComponentInstance<any>[],
    instance: ComponentInstance<any>,
  ): ComponentInstance<any>[] {
    const result = new Array<ComponentInstance<any>>(Math.max(components.length - 1, 0));
    let out = 0;
    for (let i = 0; i < components.length; i++) {
      const component = components[i]!;
      if (component.id === instance.id) continue;
      result[out++] = component;
    }
    return result;
  }

  /**
   * Create a new ArchetypeManager
   * @param capacity - The maximum number of entities this manager can handle
   * @param componentCount - The number of components registered in the world
   */
  constructor(capacity: number, componentCount: number) {
    this.#capacity = capacity;
    this.registry = new Map();
    this.entityArchetypes = new Array(capacity);
    this.queryArchetypes = new Map();
    this.#componentCache = {};
    this.#queryMembershipDirty = true;
    this.#queryScratch = [];
    this.#updateBitfield = new BooleanArray(componentCount);

    // Create root archetype with properly sized bitfield for components
    const rootBitfield = new BooleanArray(componentCount);
    this.root = new Archetype(capacity, [], rootBitfield);
    this.registry.set(this.root.id, this.root);
  }

  /**
   * Move an entity to the archetype reached by adding a component.
   * @param entity - The entity to move
   * @param instance - The component instance being added
   * @returns The target archetype
   */
  addComponent(entity: Entity, instance: ComponentInstance<any>): Archetype {
    const oldArchetype = this.entityArchetypes[entity] ?? this.root;
    return this.#moveEntity(entity, this.#getTransitionArchetype(oldArchetype, instance, true));
  }

  /**
   * Get the components associated with an entity
   * @param entity - The entity to get the components for
   * @returns A record of component instances
   */
  getEntityComponents(entity: Entity): Readonly<Record<string, ComponentInstance<any>>> {
    // Clear cache
    for (const key in this.#componentCache) {
      delete this.#componentCache[key];
    }

    const archetype = this.entityArchetypes[entity];
    if (!archetype) return this.#componentCache;

    // Reuse cache object
    const components = archetype.components;
    const len = components.length;
    for (let i = 0; i < len; i++) {
      const component = components[i];
      if (component) {
        this.#componentCache[component.name] = component;
      }
    }
    return this.#componentCache;
  }

  /**
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
  getEntityArchetype(entity: Entity): Archetype | undefined {
    return this.entityArchetypes[entity];
  }

  /**
   * Called by `world.init()`
   *
   * Initialize the ArchetypeManager
   * @returns this
   */
  init(): this {
    this.entityArchetypes.length = this.#capacity;
    for (let i = 0; i < this.#capacity; i++) {
      this.entityArchetypes[i] = this.set(this.root, i);
    }
    return this;
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
  isEntityInRoot(entity: Entity): boolean {
    return this.entityArchetypes[entity] === this.root;
  }

  /**
   * Get the Archetypes associated with a QueryInstance
   * @param query The QueryInstance
   * @returns An IterableIterator of Archetypes associated with the QueryInstance or undefined
   */
  query(query: QueryInstance): IterableIterator<Archetype> | undefined {
    return this.queryArchetypes.get(query)?.values();
  }

  /**
   * Register one query against existing archetypes without rebuilding global state.
   * @param query - The query instance to register
   * @param retainTransitions - Include dirty empty archetypes for entered/exited views
   * @returns this
   */
  registerQuery(query: QueryInstance, retainTransitions: boolean = true): this {
    let archetypeSet = this.queryArchetypes.get(query);
    if (!archetypeSet) {
      archetypeSet = new Set();
      this.queryArchetypes.set(query, archetypeSet);
    } else {
      archetypeSet.clear();
    }

    query.archetypes.clear();
    for (const archetype of this.registry.values()) {
      if (!archetype.isCandidate(query)) continue;
      if (archetype.getPopulationCount() > 0 || (retainTransitions && archetype.isDirty())) {
        archetypeSet.add(archetype);
        query.archetypes.add(archetype);
      }
    }
    query.isDirty = false;
    return this;
  }

  /**
   * Run routine maintenance on the ArchetypeManager
   * @returns this
   */
  refresh(queries: MapIterator<QueryInstance>, retainTransitions: boolean = false): this {
    // Clear existing query archetype mappings
    this.queryArchetypes.clear();

    // Convert queries iterator to a reusable array to avoid exhausting it.
    const queryArray = this.#queryScratch;
    queryArray.length = 0;
    for (const query of queries) {
      queryArray.push(query);
    }

    // Initialize query archetype sets
    for (const query of queryArray) {
      this.queryArchetypes.set(query, new Set());
      query.archetypes.clear(); // Clear the QueryInstance's archetypes set
      query.isDirty = false;
    }

    // For each archetype
    for (const archetype of this.registry.values()) {
      // Check against each query
      for (const query of queryArray) {
        if (archetype.isCandidate(query)) {
          const archetypeSet = this.queryArchetypes.get(query)!;
          if (archetype.getPopulationCount() > 0 || (retainTransitions && archetype.isDirty())) {
            archetypeSet.add(archetype);
            query.archetypes.add(archetype); // Update the QueryInstance's archetypes set
          }
        }
      }
      if (!retainTransitions) archetype.refresh();
    }
    this.#queryMembershipDirty = false;
    return this;
  }

  /**
   * Rebuild query-to-archetype mappings if transitions changed them.
   * @param queries - The registered query instances
   * @param retainTransitions - Keep entered/exited state while refreshing membership
   * @returns this
   */
  ensureQueryMembership(queries: MapIterator<QueryInstance>, retainTransitions: boolean = true): this {
    if (this.#queryMembershipDirty) {
      this.refresh(queries, retainTransitions);
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
   * Move an entity to the archetype reached by removing a component.
   * @param entity - The entity to move
   * @param instance - The component instance being removed
   * @returns The target archetype
   */
  removeComponent(entity: Entity, instance: ComponentInstance<any>): Archetype {
    const oldArchetype = this.entityArchetypes[entity] ?? this.root;
    return this.#moveEntity(entity, this.#getTransitionArchetype(oldArchetype, instance, false));
  }

  /**
   * Set the Archetype associated with an Entity
   * @param archetype The Archetype
   * @param entity The Entity
   * @returns this
   * @throws {NotRegisteredError} If the Archetype is not registered
   */
  set(archetype: Archetype, entity: Entity): Archetype {
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
    this.#queryMembershipDirty = true;
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

  /**
   * @internal
   * Update the Archetype associated with an Entity based on its components
   * @param entity The Entity
   * @param components The ComponentInstances
   * @returns The Archetype associated with the Entity
   */
  update(entity: Entity, components: ComponentInstance<any>[]): Archetype {
    const oldArchetype = this.entityArchetypes[entity];

    // Reset and update bitfield
    this.#updateBitfield.clear();
    this.#updateBitfield.setFromObjects(ID_KEY, components, true);

    // Get or create archetype for these components
    const archetypeId = this.#updateBitfield.buffer.toString();
    if (oldArchetype?.id === archetypeId) return oldArchetype;

    let archetype = this.registry.get(archetypeId);
    if (!archetype) {
      archetype = new Archetype(this.#capacity, components, this.#updateBitfield.clone());
      this.registry.set(archetypeId, archetype);
    }

    return this.#moveEntity(entity, archetype);
  }
}
