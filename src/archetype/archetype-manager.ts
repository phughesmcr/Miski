/**
 * @module      ArchetypeManager
 * @description The ArchetypeManager is responsible for managing Archetypes and their associated Entities.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";

import { NotRegisteredError } from "@/errors.ts";
import type { DynamicComponentInstance, Entity, QueryInstance } from "@/types.ts";
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
  #componentCache: Record<string, DynamicComponentInstance>;

  /** Whether query-to-archetype mappings need to be rebuilt */
  #queryMembershipDirty: boolean;

  /** Reusable query list for refresh passes */
  #queryScratch: QueryInstance[];

  /** Reusable grouped entity storage for batch component transitions */
  #bulkEntities: Uint32Array;

  /** Reusable group counts for batch component transitions */
  #bulkGroupCounts: number[];

  /** Reusable group offsets for batch component transitions */
  #bulkGroupOffsets: number[];

  /** Reusable group write offsets for batch component transitions */
  #bulkGroupWrites: number[];

  /** Reusable source archetypes for batch component transitions */
  #bulkSources: Archetype[];

  /** Reusable target archetypes for batch component transitions */
  #bulkTargets: Archetype[];

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
   * Move a dense entity list through a single-component transition grouped by source archetype.
   * @param entities - Dense entity IDs
   * @param count - Number of entity IDs to read
   * @param instance - The component instance being added or removed
   * @param add - Whether the component is being added
   * @returns The number of entities moved to a different archetype
   */
  #moveEntities(
    entities: Uint32Array,
    count: number,
    instance: DynamicComponentInstance,
    add: boolean,
  ): number {
    if (count === 0) return 0;

    const sources = this.#bulkSources;
    const targets = this.#bulkTargets;
    const counts = this.#bulkGroupCounts;
    const offsets = this.#bulkGroupOffsets;
    const writes = this.#bulkGroupWrites;
    sources.length = 0;
    targets.length = 0;

    for (let i = 0; i < count; i++) {
      const entity = entities[i]!;
      const source = this.entityArchetypes[entity] ?? this.root;
      let group = -1;
      for (let j = 0; j < sources.length; j++) {
        if (sources[j] === source) {
          group = j;
          break;
        }
      }
      if (group === -1) {
        const target = this.#getTransitionArchetype(source, instance, add);
        if (source === target) continue;
        group = sources.length;
        sources[group] = source;
        targets[group] = target;
        counts[group] = 0;
      }
      counts[group] = (counts[group] ?? 0) + 1;
    }

    let moved = 0;
    for (let group = 0; group < sources.length; group++) {
      offsets[group] = moved;
      writes[group] = moved;
      moved += counts[group] ?? 0;
    }
    if (moved === 0) {
      return 0;
    }

    for (let i = 0; i < count; i++) {
      const entity = entities[i]!;
      const source = this.entityArchetypes[entity] ?? this.root;
      let group = -1;
      for (let j = 0; j < sources.length; j++) {
        if (sources[j] === source) {
          group = j;
          break;
        }
      }
      if (group === -1) continue;
      const write = writes[group]!;
      this.#bulkEntities[write] = entity;
      writes[group] = write + 1;
    }

    for (let group = 0; group < sources.length; group++) {
      const source = sources[group]!;
      const target = targets[group]!;
      const offset = offsets[group]!;
      const groupCount = counts[group] ?? 0;
      source.removeEntities(this.#bulkEntities, offset, groupCount);
      target.addEntities(this.#bulkEntities, offset, groupCount);
      const end = offset + groupCount;
      for (let i = offset; i < end; i++) {
        this.entityArchetypes[this.#bulkEntities[i]!] = target;
        this.#bulkEntities[i] = 0;
      }
      counts[group] = 0;
      offsets[group] = 0;
      writes[group] = 0;
    }

    sources.length = 0;
    targets.length = 0;
    this.#queryMembershipDirty = true;
    return moved;
  }

  /**
   * Get or create the archetype reached by adding/removing one component.
   * @param from - The source archetype
   * @param instance - The component being added or removed
   * @param add - Whether the component is being added
   * @returns The target archetype
   */
  #getTransitionArchetype(from: Archetype, instance: DynamicComponentInstance, add: boolean): Archetype {
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
      const components = add ?
        this.#componentsWithAdded(from.components, instance) :
        this.#componentsWithRemoved(from.components, instance);
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
    components: readonly DynamicComponentInstance[],
    instance: DynamicComponentInstance,
  ): DynamicComponentInstance[] {
    const result = new Array<DynamicComponentInstance>(components.length + 1);
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
    components: readonly DynamicComponentInstance[],
    instance: DynamicComponentInstance,
  ): DynamicComponentInstance[] {
    const result = new Array<DynamicComponentInstance>(Math.max(components.length - 1, 0));
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
    this.#bulkEntities = new Uint32Array(capacity);
    this.#bulkGroupCounts = [];
    this.#bulkGroupOffsets = [];
    this.#bulkGroupWrites = [];
    this.#bulkSources = [];
    this.#bulkTargets = [];

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
  addComponent(entity: Entity, instance: DynamicComponentInstance): Archetype {
    const oldArchetype = this.entityArchetypes[entity] ?? this.root;
    return this.#moveEntity(entity, this.#getTransitionArchetype(oldArchetype, instance, true));
  }

  /**
   * Move entities to the archetypes reached by adding a component.
   * @param entities - Dense entity IDs
   * @param count - Number of entity IDs to read
   * @param instance - The component instance being added
   * @returns The number of entities moved to a different archetype
   */
  addComponents(entities: Uint32Array, count: number, instance: DynamicComponentInstance): number {
    return this.#moveEntities(entities, count, instance, true);
  }

  /**
   * Get the components associated with an entity
   * @param entity - The entity to get the components for
   * @returns A record of component instances
   */
  getEntityComponents(entity: Entity): Readonly<Record<string, DynamicComponentInstance>> {
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
    // Convert queries iterator to a reusable array to avoid exhausting it.
    const queryArray = this.#queryScratch;
    queryArray.length = 0;
    for (const query of queries) {
      queryArray.push(query);
    }

    // Initialize query archetype sets
    for (const query of queryArray) {
      let archetypeSet = this.queryArchetypes.get(query);
      if (!archetypeSet) {
        archetypeSet = new Set();
        this.queryArchetypes.set(query, archetypeSet);
      } else {
        archetypeSet.clear();
      }
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
  removeComponent(entity: Entity, instance: DynamicComponentInstance): Archetype {
    const oldArchetype = this.entityArchetypes[entity] ?? this.root;
    return this.#moveEntity(entity, this.#getTransitionArchetype(oldArchetype, instance, false));
  }

  /**
   * Move entities to the archetypes reached by removing a component.
   * @param entities - Dense entity IDs
   * @param count - Number of entity IDs to read
   * @param instance - The component instance being removed
   * @returns The number of entities moved to a different archetype
   */
  removeComponents(entities: Uint32Array, count: number, instance: DynamicComponentInstance): number {
    return this.#moveEntities(entities, count, instance, false);
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
}
