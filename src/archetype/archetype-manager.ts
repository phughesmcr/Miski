import { BooleanArray } from "@phughesmcr/booleanarray";

import { createSlotArray, type EntityArray } from "@/entity/entity.ts";
import { NotRegisteredError } from "@/errors.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import { type Entity, entityIndex, packEntity, type PackSlot } from "@/entity/entity.ts";
import type { QueryInstance } from "@/types/query.ts";
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

  /** Reusable grouped slot storage for batch component transitions */
  #bulkSlots: EntityArray;

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

  /** Pack slot → entity for archetype public iterators / query writes */
  #packSlot: PackSlot;

  /**
   * Move an entity to a
   * new archetype and mark query membership dirty.
   * @param entity - The entity to move
   * @param archetype - The target archetype
   * @returns The target archetype
   */
  #moveEntity(entity: Entity, archetype: Archetype, slot: number = entityIndex(entity)): Archetype {
    const oldArchetype = this.entityArchetypes[slot];
    if (oldArchetype === archetype) return archetype;

    oldArchetype?.removeEntity(entity, slot);
    archetype.addEntity(entity, slot);
    this.entityArchetypes[slot] = archetype;
    this.#queryMembershipDirty = true;

    return archetype;
  }

  /**
   * Move a dense slot list through a single-component transition grouped by source archetype.
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being added or removed
   * @param add - Whether the component is being added
   * @returns The number of entities moved to a different archetype
   */
  #moveEntities(
    slots: EntityArray,
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
      const slot = slots[i]!;
      const source = this.entityArchetypes[slot] ?? this.root;
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
      const slot = slots[i]!;
      const source = this.entityArchetypes[slot] ?? this.root;
      let group = -1;
      for (let j = 0; j < sources.length; j++) {
        if (sources[j] === source) {
          group = j;
          break;
        }
      }
      if (group === -1) continue;
      const write = writes[group]!;
      this.#bulkSlots[write] = slot;
      writes[group] = write + 1;
    }

    for (let group = 0; group < sources.length; group++) {
      const source = sources[group]!;
      const target = targets[group]!;
      const offset = offsets[group]!;
      const groupCount = counts[group] ?? 0;
      source.removeEntities(this.#bulkSlots, offset, groupCount);
      target.addEntities(this.#bulkSlots, offset, groupCount);
      const end = offset + groupCount;
      for (let i = offset; i < end; i++) {
        this.entityArchetypes[this.#bulkSlots[i]!] = target;
        this.#bulkSlots[i] = 0;
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
      archetype = new Archetype(this.#capacity, components, bitfield, this.#packSlot);
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
   * Build a component list with multiple components inserted by registry id.
   * @param components - The source component list
   * @param added - Components to add
   * @returns A sorted component list for the target archetype
   */
  #componentsWithAddedSet(
    components: readonly DynamicComponentInstance[],
    added: readonly DynamicComponentInstance[],
  ): DynamicComponentInstance[] {
    const byId: DynamicComponentInstance[] = [];
    let maxId = -1;
    for (let i = 0; i < components.length; i++) {
      const component = components[i]!;
      byId[component.id] = component;
      if (component.id > maxId) maxId = component.id;
    }
    for (let i = 0; i < added.length; i++) {
      const component = added[i]!;
      byId[component.id] = component;
      if (component.id > maxId) maxId = component.id;
    }

    const result: DynamicComponentInstance[] = [];
    for (let id = 0; id <= maxId; id++) {
      const component = byId[id];
      if (component) result.push(component);
    }
    return result;
  }

  /**
   * Get or create the archetype reached by adding a set of components.
   * @param from - The source archetype
   * @param instances - Components being added
   * @returns The target archetype
   */
  #getSetTransitionArchetype(
    from: Archetype,
    instances: readonly DynamicComponentInstance[],
  ): Archetype {
    if (instances.length === 0) return from;

    const bitfield = from.bitfield.clone();
    let changed = false;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      if (bitfield.get(instance.id)) continue;
      bitfield.set(instance.id, true);
      changed = true;
    }
    if (!changed) return from;

    const archetypeId = bitfield.buffer.toString();
    let archetype = this.registry.get(archetypeId);
    if (!archetype) {
      archetype = new Archetype(
        this.#capacity,
        this.#componentsWithAddedSet(from.components, instances),
        bitfield,
        this.#packSlot,
      );
      this.registry.set(archetypeId, archetype);
    }
    return archetype;
  }

  /**
   * Rebuild query membership while preserving the caller's transition lifecycle.
   * @param queries - Query instances whose archetype membership should be rebuilt
   * @param includeDirtyArchetypes - Include dirty empty archetypes for entered/exited views
   * @param refreshArchetypes - Clear archetype transition state after membership is rebuilt
   */
  #rebuildQueryMembership(
    queries: readonly QueryInstance[],
    includeDirtyArchetypes: boolean,
    refreshArchetypes: boolean,
  ): void {
    for (const query of queries) {
      let archetypeSet = this.queryArchetypes.get(query);
      if (!archetypeSet) {
        archetypeSet = new Set();
        this.queryArchetypes.set(query, archetypeSet);
      } else {
        archetypeSet.clear();
      }
      query.archetypes.clear();
      query.isDirty = false;
    }

    for (const archetype of this.registry.values()) {
      for (const query of queries) {
        if (!archetype.isCandidate(query)) continue;

        const archetypeSet = this.queryArchetypes.get(query)!;
        if (archetype.getPopulationCount() > 0 || (includeDirtyArchetypes && archetype.isDirty())) {
          archetypeSet.add(archetype);
          query.archetypes.add(archetype);
        }
      }
      if (refreshArchetypes) archetype.refresh();
    }
  }

  /**
   * Create a new ArchetypeManager
   * @param capacity - The maximum number of entities this manager can handle
   * @param componentCount - The number of components registered in the world
   * @param packSlot - Packs a live slot into an entity handle (defaults to generation 0)
   */
  constructor(
    capacity: number,
    componentCount: number,
    packSlot: PackSlot = (slot) => packEntity(slot, 0),
  ) {
    this.#capacity = capacity;
    this.#packSlot = packSlot;
    this.registry = new Map();
    this.entityArchetypes = new Array(capacity);
    this.queryArchetypes = new Map();
    this.#componentCache = {};
    this.#queryMembershipDirty = true;
    this.#queryScratch = [];
    this.#bulkSlots = createSlotArray(capacity);
    this.#bulkGroupCounts = [];
    this.#bulkGroupOffsets = [];
    this.#bulkGroupWrites = [];
    this.#bulkSources = [];
    this.#bulkTargets = [];

    // Create root archetype with properly sized bitfield for components
    const rootBitfield = new BooleanArray(componentCount);
    this.root = new Archetype(capacity, [], rootBitfield, packSlot);
    this.registry.set(this.root.id, this.root);
  }

  /**
   * Move an entity to the archetype reached by adding a component.
   * @param entity - The entity to move
   * @param instance - The component instance being added
   * @returns The target archetype
   */
  addComponent(entity: Entity, instance: DynamicComponentInstance, slot: number = entityIndex(entity)): Archetype {
    const oldArchetype = this.entityArchetypes[slot] ?? this.root;
    return this.#moveEntity(entity, this.#getTransitionArchetype(oldArchetype, instance, true), slot);
  }

  /**
   * Move entities to the archetypes reached by adding a component.
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being added
   * @returns The number of entities moved to a different archetype
   */
  addComponents(slots: EntityArray, count: number, instance: DynamicComponentInstance): number {
    return this.#moveEntities(slots, count, instance, true);
  }

  /** Add a newly-created active entity to the root archetype. */
  createEntity(entity: Entity): Archetype {
    return this.set(this.root, entity);
  }

  /**
   * Move an entity once to the archetype reached by adding a component set.
   * @param entity - The entity to move
   * @param instances - Components whose ownership changed to owned
   * @returns The target archetype
   */
  addComponentSet(entity: Entity, instances: readonly DynamicComponentInstance[]): Archetype {
    const slot = entityIndex(entity);
    const oldArchetype = this.entityArchetypes[slot] ?? this.root;
    return this.#moveEntity(entity, this.#getSetTransitionArchetype(oldArchetype, instances), slot);
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

    const archetype = this.entityArchetypes[entityIndex(entity)];
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

  /** Remove a destroyed entity from whichever archetype currently owns it. */
  destroyEntity(entity: Entity): this {
    const slot = entityIndex(entity);
    const archetype = this.entityArchetypes[slot];
    if (archetype !== undefined) {
      archetype.removeEntity(entity, slot);
      delete this.entityArchetypes[slot];
      this.#queryMembershipDirty = true;
    }
    return this;
  }

  /**
   * Get the Archetype associated with an Entity
   * @param entity The Entity
   * @returns The Archetype associated with the Entity or undefined
   */
  getEntityArchetype(entity: Entity): Archetype | undefined {
    return this.entityArchetypes[entityIndex(entity)];
  }

  /**
   * Called by `world.init()`
   *
   * Initialize the ArchetypeManager
   * @returns this
   */
  init(): this {
    this.entityArchetypes.length = this.#capacity;
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
    return this.entityArchetypes[entityIndex(entity)] === this.root;
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
    this.#rebuildQueryMembership([query], retainTransitions, false);
    return this;
  }

  /**
   * Run routine maintenance on the ArchetypeManager
   * @returns this
   */
  refresh(queries: MapIterator<QueryInstance>, retainTransitions: boolean = false): this {
    if (this.#queryMembershipDirty) {
      // Convert queries iterator to a reusable array to avoid exhausting it.
      const queryArray = this.#queryScratch;
      queryArray.length = 0;
      for (const query of queries) {
        queryArray.push(query);
      }

      this.#rebuildQueryMembership(queryArray, retainTransitions, !retainTransitions);
      this.#queryMembershipDirty = false;
    } else if (!retainTransitions) {
      for (const archetype of this.registry.values()) {
        archetype.refresh();
      }
    }
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
  removeComponent(entity: Entity, instance: DynamicComponentInstance, slot: number = entityIndex(entity)): Archetype {
    const oldArchetype = this.entityArchetypes[slot] ?? this.root;
    return this.#moveEntity(entity, this.#getTransitionArchetype(oldArchetype, instance, false), slot);
  }

  /**
   * Move entities to the archetypes reached by removing a component.
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being removed
   * @returns The number of entities moved to a different archetype
   */
  removeComponents(slots: EntityArray, count: number, instance: DynamicComponentInstance): number {
    return this.#moveEntities(slots, count, instance, false);
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
    const slot = entityIndex(entity);
    if (slot >= this.entityArchetypes.length || slot < 0) {
      throw new RangeError("Invalid entity.");
    }

    const currentArchetype = this.entityArchetypes[slot];
    if (currentArchetype === archetype) return archetype;

    currentArchetype?.removeEntity(entity, slot);
    this.entityArchetypes[slot] = archetype;
    archetype.addEntity(entity, slot);
    this.#queryMembershipDirty = true;
    return archetype;
  }

  /**
   * Rebuild the entity-to-archetype map from component ownership.
   * @internal
   */
  rebuildFromOwnership(
    activeEntities: Iterable<Entity>,
    getOwnedInstances: (entity: Entity) => readonly DynamicComponentInstance[],
  ): void {
    for (const archetype of this.registry.values()) {
      archetype.clearPopulation();
    }
    for (let slot = 0; slot < this.#capacity; slot++) {
      delete this.entityArchetypes[slot];
    }

    for (const entity of activeEntities) {
      const owned = getOwnedInstances(entity);
      const archetype = owned.length === 0 ? this.root : this.#getSetTransitionArchetype(this.root, owned);
      this.entityArchetypes[entityIndex(entity)] = archetype;
      archetype.addEntity(entity);
    }
    this.#queryMembershipDirty = true;
  }
}
