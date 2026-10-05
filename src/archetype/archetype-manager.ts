import { BooleanArray } from "@phughesmcr/booleanarray";

import { type Entity, type EntityArray, entityIndex, packEntity, type PackSlot } from "@/entity/entity.ts";
import { EntityNotFoundError, formatEntityNotActive, NotRegisteredError } from "@/errors.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance, QueryInstanceList } from "@/types/query.ts";
import { Archetype } from "./archetype.ts";
import { ArchetypeBatchMove, type TransitionArchetypeGetter } from "./archetype-batch-move.ts";
import { MembershipTracker } from "./membership-tracker.ts";
import { TransitionWindow, type TransitionWindowSnapshot } from "./transition-window.ts";

/** Rollback copy of every archetype's entered/exited window plus per-entity window origins. */
export type ArchetypeTransitionSnapshot = {
  readonly archetypes: Map<Archetype, { entered: Entity[]; exited: Entity[] }>;
  readonly window: TransitionWindowSnapshot;
};

/**
 * Index of the first listed archetype whose registry index is not below `index`.
 * Query archetype lists are kept sorted by registry index so incremental updates match a full rebuild.
 */
function lowerBound(query: QueryInstance, index: number): number {
  const list = query.archetypes;
  let low = 0;
  let high = query.archetypeCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid]!.registryIndex < index) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Insert an archetype into a query's sorted archetype list if it is not already listed. */
function listArchetype(query: QueryInstance, archetype: Archetype): void {
  const list = query.archetypes;
  const count = query.archetypeCount;
  const position = lowerBound(query, archetype.registryIndex);
  if (position < count && list[position] === archetype) return;
  for (let i = count; i > position; i--) list[i] = list[i - 1]!;
  list[position] = archetype;
  query.archetypeCount = count + 1;
}

/** Remove an archetype from a query's sorted archetype list if it is listed. */
function unlistArchetype(query: QueryInstance, archetype: Archetype): void {
  const list = query.archetypes;
  const count = query.archetypeCount;
  const position = lowerBound(query, archetype.registryIndex);
  if (position >= count || list[position] !== archetype) return;
  for (let i = position; i < count - 1; i++) list[i] = list[i + 1]!;
  query.archetypeCount = count - 1;
}

/** ArchetypeManager handles creation and allocation of Archetypes */
export class ArchetypeManager {
  /** Archetypes by their id */
  readonly registry: Map<string, Archetype>;

  /** Archetypes indexed by Entity storage slot (`undefined` = no archetype) */
  readonly entityArchetypes: Array<Archetype | undefined>;

  /** Entities in this archetype have no components */
  readonly root: Archetype;

  /** The maximum number of entities this manager can handle. */
  #capacity: number;

  /** Number of components registered in the world (transition edge array size). */
  #componentCount: number;

  /**
   * Whether every query-to-archetype mapping must be rebuilt from scratch.
   * Ordinary entity moves only queue the archetypes whose emptiness changed; this is reserved for
   * initialization and bulk rewrites (rollback).
   */
  #membershipRebuildRequired: boolean;

  /** Archetypes whose population crossed the empty boundary since membership was last reconciled */
  readonly #tracker: MembershipTracker = new MembershipTracker();

  /** Archetype each entity occupied when the current refresh window began */
  readonly #window: TransitionWindow;

  /** Dense archetype list parallel to {@link registry} (hot membership rebuilds). */
  readonly #archetypes: Archetype[] = [];

  /** Valid prefix length of {@link #archetypes}. */
  #archetypeCount: number = 0;

  /** Reusable one-query list for {@link registerQuery}. */
  readonly #singleQueryList: { queries: QueryInstance[]; count: number };

  /** Batch single-component transition scratch and move logic */
  #batchMove: ArchetypeBatchMove;

  /**
   * Stable transition resolver for batch moves.
   * Cached once so hot `#moveEntities` calls do not allocate a closure per invocation.
   */
  #getTransitionForBatch: TransitionArchetypeGetter;

  /** Pack slot -> entity for archetype public iterators / query writes */
  #packSlot: PackSlot;

  #requireEntitySlot(entity: Entity, slot: number): void {
    if (slot !== entityIndex(entity) || slot >= this.#capacity || this.#packSlot(slot) !== entity) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
  }

  /**
   * Register a newly created archetype in both the id map and dense list.
   * @param archetypeId - Stable bitfield-derived id
   * @param archetype - The archetype to register
   */
  #registerArchetype(archetypeId: string, archetype: Archetype): void {
    archetype.registryIndex = this.#archetypeCount;
    this.registry.set(archetypeId, archetype);
    this.#archetypes[this.#archetypeCount++] = archetype;
  }

  /**
   * Move an entity to a new archetype, recording its window origin and any emptiness change.
   * @param entity - The entity to move
   * @param archetype - The target archetype
   * @returns The target archetype
   */
  #moveEntity(entity: Entity, archetype: Archetype, slot: number = entityIndex(entity)): Archetype {
    this.#requireEntitySlot(entity, slot);
    const oldArchetype = this.entityArchetypes[slot];
    if (oldArchetype === archetype) return archetype;

    this.#window.touch(slot, oldArchetype);
    if (oldArchetype !== undefined) {
      oldArchetype.removeEntity(entity, slot);
      if (oldArchetype.getPopulationCount() === 0) this.#tracker.markEmptied(oldArchetype);
    }
    archetype.addEntity(entity, slot);
    if (archetype.getPopulationCount() === 1) this.#tracker.markPopulated(archetype);
    this.entityArchetypes[slot] = archetype;

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
    return this.#batchMove.moveEntities(
      this.entityArchetypes,
      this.root,
      this.#getTransitionForBatch,
      slots,
      count,
      instance,
      add,
    );
  }

  /**
   * Get or create the archetype reached by adding/removing one component.
   * @param from - The source archetype
   * @param instance - The component being added or removed
   * @param add - Whether the component is being added
   * @returns The target archetype
   */
  #getTransitionArchetype(from: Archetype, instance: DynamicComponentInstance, add: boolean): Archetype {
    // Warm transitions skip the bitfield probe (hot add/remove path).
    const transitions = add ? from.addTransitions : from.removeTransitions;
    const cached = transitions[instance.id];
    if (cached) return cached;

    const hasComponent = from.bitfield.get(instance.id);
    if (hasComponent === add) {
      transitions[instance.id] = from;
      return from;
    }

    const bitfield = from.bitfield.clone();
    bitfield.set(instance.id, add);
    const archetypeId = bitfield.buffer.toString();
    let archetype = this.registry.get(archetypeId);

    if (!archetype) {
      const components = add ?
        this.#componentsWithAdded(from.components, instance) :
        this.#componentsWithRemoved(from.components, instance);
      archetype = new Archetype(this.#capacity, components, bitfield, this.#packSlot, this.#componentCount);
      this.#registerArchetype(archetypeId, archetype);
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
   * Get or create the archetype reached by adding a set of components.
   * Walks warm single-component edges so hot bundle spawns avoid bitfield clone/toString.
   * @param from - The source archetype
   * @param instances - Components being added
   * @param count - Active prefix length of `instances`
   * @returns The target archetype
   */
  #getSetTransitionArchetype(
    from: Archetype,
    instances: readonly DynamicComponentInstance[],
    count: number = instances.length,
  ): Archetype {
    let current = from;
    for (let i = 0; i < count; i++) {
      current = this.#getTransitionArchetype(current, instances[i]!, true);
    }
    return current;
  }

  /**
   * Rebuild query membership while preserving the caller's transition lifecycle.
   * @param queries - Dense query list whose archetype membership should be rebuilt
   * @param includeDirtyArchetypes - Include dirty empty archetypes for entered/exited views
   * @param refreshArchetypes - Clear archetype transition state after membership is rebuilt
   */
  #rebuildQueryMembership(
    queries: QueryInstanceList,
    includeDirtyArchetypes: boolean,
    refreshArchetypes: boolean,
  ): void {
    const queryArray = queries.queries;
    const queryCount = queries.count;
    for (let q = 0; q < queryCount; q++) {
      const query = queryArray[q]!;
      query.archetypeCount = 0;
    }

    const archetypes = this.#archetypes;
    const archetypeCount = this.#archetypeCount;
    for (let a = 0; a < archetypeCount; a++) {
      const archetype = archetypes[a]!;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (!archetype.isCandidate(query)) continue;
        if (archetype.getPopulationCount() > 0 || (includeDirtyArchetypes && archetype.isDirty())) {
          query.archetypes[query.archetypeCount++] = archetype;
        }
      }
      if (refreshArchetypes) archetype.refresh();
    }
  }

  /**
   * Add newly populated archetypes to the query lists they match.
   * @param queries - Dense query list to update
   * @param includeDirtyArchetypes - Also list empty archetypes whose entered/exited window is still open
   */
  #listPopulatedArchetypes(queries: QueryInstanceList, includeDirtyArchetypes: boolean): void {
    const tracker = this.#tracker;
    const queryArray = queries.queries;
    const queryCount = queries.count;
    for (let i = 0; i < tracker.populatedCount; i++) {
      const archetype = tracker.populated[i]!;
      if (archetype.getPopulationCount() === 0 && !(includeDirtyArchetypes && archetype.isDirty())) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) listArchetype(query, archetype);
      }
    }
    tracker.clearPopulated();
  }

  /** Drop archetypes that emptied out from the query lists that still hold them. */
  #unlistEmptiedArchetypes(queries: QueryInstanceList): void {
    const tracker = this.#tracker;
    const queryArray = queries.queries;
    const queryCount = queries.count;
    for (let i = 0; i < tracker.emptiedCount; i++) {
      const archetype = tracker.emptied[i]!;
      if (archetype.getPopulationCount() !== 0) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) unlistArchetype(query, archetype);
      }
    }
    tracker.clearEmptied();
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
    this.#componentCount = componentCount;
    this.#packSlot = packSlot;
    this.registry = new Map();
    this.entityArchetypes = new Array(capacity);
    this.#membershipRebuildRequired = true;
    this.#singleQueryList = { queries: [], count: 0 };
    this.#window = new TransitionWindow(capacity, packSlot);
    this.#batchMove = new ArchetypeBatchMove(capacity, this.#window, this.#tracker);
    this.#getTransitionForBatch = (from, component, isAdd) => this.#getTransitionArchetype(from, component, isAdd);

    // Create root archetype with properly sized bitfield for components
    const rootBitfield = new BooleanArray(componentCount);
    this.root = new Archetype(capacity, [], rootBitfield, packSlot, componentCount);
    this.#registerArchetype(this.root.id, this.root);
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
   * @param count - Active prefix length of `instances` (defaults to `instances.length`)
   * @returns The target archetype
   */
  addComponentSet(
    entity: Entity,
    instances: readonly DynamicComponentInstance[],
    count: number = instances.length,
  ): Archetype {
    const slot = entityIndex(entity);
    const oldArchetype = this.entityArchetypes[slot] ?? this.root;
    return this.#moveEntity(entity, this.#getSetTransitionArchetype(oldArchetype, instances, count), slot);
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
    this.#archetypeCount = 0;
    return this;
  }

  /** Remove a destroyed entity from whichever archetype currently owns it. */
  destroyEntity(entity: Entity): this {
    const slot = entityIndex(entity);
    this.#requireEntitySlot(entity, slot);
    const archetype = this.entityArchetypes[slot];
    if (archetype !== undefined) {
      this.#window.touch(slot, archetype);
      archetype.removeEntity(entity, slot);
      if (archetype.getPopulationCount() === 0) this.#tracker.markEmptied(archetype);
      this.entityArchetypes[slot] = undefined;
    }
    return this;
  }

  /**
   * Get the Archetype associated with an Entity
   * @param entity The Entity
   * @returns The Archetype associated with the Entity or undefined
   */
  getEntityArchetype(entity: Entity): Archetype | undefined {
    const slot = entityIndex(entity);
    if (this.#packSlot(slot) !== entity) return undefined;
    return this.entityArchetypes[slot];
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
   * Get the archetype an entity occupied when the current refresh window began.
   * @param entity The Entity
   * @returns The archetype, or `undefined` if the entity did not exist at window start
   */
  getWindowOrigin(entity: Entity): Archetype | undefined {
    return this.#window.originOf(entity);
  }

  /**
   * Check if an Entity is in the root archetype
   * @param entity The Entity
   * @returns `true` if the Entity is in the root archetype, `false` otherwise
   */
  isEntityInRoot(entity: Entity): boolean {
    return this.getEntityArchetype(entity) === this.root;
  }

  /**
   * Register one query against existing archetypes without rebuilding global state.
   * @param query - The query instance to register
   * @param retainTransitions - Include dirty empty archetypes for entered/exited views
   * @returns this
   */
  registerQuery(query: QueryInstance, retainTransitions: boolean = true): this {
    const list = this.#singleQueryList;
    list.queries[0] = query;
    list.count = 1;
    this.#rebuildQueryMembership(list, retainTransitions, false);
    return this;
  }

  /**
   * Run routine maintenance on the ArchetypeManager
   * @returns this
   */
  refresh(queries: QueryInstanceList, retainTransitions: boolean = false): this {
    if (this.#membershipRebuildRequired) {
      this.#rebuildQueryMembership(queries, retainTransitions, !retainTransitions);
      this.#membershipRebuildRequired = false;
      this.#tracker.clearPopulated();
      if (!retainTransitions) {
        this.#tracker.clearEmptied();
        this.#window.clear();
      }
      return this;
    }
    if (this.#tracker.populatedCount > 0) this.#listPopulatedArchetypes(queries, retainTransitions);
    if (!retainTransitions) {
      this.#unlistEmptiedArchetypes(queries);
      const archetypes = this.#archetypes;
      const archetypeCount = this.#archetypeCount;
      for (let i = 0; i < archetypeCount; i++) {
        archetypes[i]!.refresh();
      }
      this.#window.clear();
    }
    return this;
  }

  /**
   * Reconcile query-to-archetype mappings with archetypes that became populated since the last call.
   * Only archetypes whose emptiness changed are visited; a full rebuild happens only when required.
   * @param queries - The registered query instances
   * @param retainTransitions - Keep entered/exited state while refreshing membership
   * @returns this
   */
  ensureQueryMembership(queries: QueryInstanceList, retainTransitions: boolean = true): this {
    if (this.#membershipRebuildRequired) {
      this.refresh(queries, retainTransitions);
    } else if (this.#tracker.populatedCount > 0) {
      this.#listPopulatedArchetypes(queries, retainTransitions);
    }
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
    this.#requireEntitySlot(entity, slot);
    if (slot >= this.entityArchetypes.length || slot < 0) {
      throw new RangeError("Invalid entity.");
    }

    const currentArchetype = this.entityArchetypes[slot];
    if (currentArchetype === archetype) return archetype;

    this.#window.touch(slot, currentArchetype);
    if (currentArchetype !== undefined) {
      currentArchetype.removeEntity(entity, slot);
      if (currentArchetype.getPopulationCount() === 0) this.#tracker.markEmptied(currentArchetype);
    }
    this.entityArchetypes[slot] = archetype;
    archetype.addEntity(entity, slot);
    if (archetype.getPopulationCount() === 1) this.#tracker.markPopulated(archetype);
    return archetype;
  }

  /** Capture transition windows for rollback, retaining archetype identity. */
  captureTransitions(): ArchetypeTransitionSnapshot {
    return {
      archetypes: new Map(this.#archetypes.map((archetype) => [archetype, archetype.captureTransitions()])),
      window: this.#window.capture(),
    };
  }

  /** Restore pre-scope windows and discard transitions from speculative archetypes. */
  restoreTransitions(snapshot: ArchetypeTransitionSnapshot): void {
    for (const archetype of this.#archetypes) {
      archetype.refresh();
      const state = snapshot.archetypes.get(archetype);
      if (state !== undefined) archetype.restoreTransitions(state);
    }
    this.#window.restore(snapshot.window);
    this.#membershipRebuildRequired = true;
  }

  /**
   * Rebuild the entity-to-archetype map from component ownership.
   * @internal
   */
  rebuildFromOwnership(
    activeEntities: Iterable<Entity>,
    getOwnedInstances: (entity: Entity) => readonly DynamicComponentInstance[],
  ): void {
    const archetypes = this.#archetypes;
    const archetypeCount = this.#archetypeCount;
    for (let i = 0; i < archetypeCount; i++) {
      archetypes[i]!.clearPopulation();
    }
    for (let slot = 0; slot < this.#capacity; slot++) {
      this.entityArchetypes[slot] = undefined;
    }

    for (const entity of activeEntities) {
      const owned = getOwnedInstances(entity);
      const archetype = owned.length === 0 ? this.root : this.#getSetTransitionArchetype(this.root, owned);
      this.entityArchetypes[entityIndex(entity)] = archetype;
      archetype.addEntity(entity);
    }
    this.#membershipRebuildRequired = true;
  }
}
