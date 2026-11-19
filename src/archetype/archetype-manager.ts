import { BooleanArray } from "@phughesmcr/booleanarray";

import {
  createSlotArray,
  type Entity,
  type EntityArray,
  entityIndex,
  packEntity,
  type PackSlot,
} from "@/entity/entity.ts";
import { EntityNotFoundError, formatEntityNotActive, NotRegisteredError } from "@/errors.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance, QueryInstanceList } from "@/types/query.ts";
import { Archetype, nextArchetypeStamp } from "./archetype.ts";
import { ArchetypeBatchMove, type TransitionArchetypeGetter } from "./archetype-batch-move.ts";
import { MembershipTracker } from "./membership-tracker.ts";
import { TransitionWindow, type TransitionWindowSnapshot } from "./transition-window.ts";

/** Rollback copy of archetype populations (in iteration order) and per-entity window origins. */
export type ArchetypeManagerSnapshot = {
  /** Number of archetypes registered at capture; later ones are speculative and dropped on restore. */
  readonly archetypeCount: number;
  /** Dense population of each non-empty archetype, keyed by registry index. */
  readonly populations: ReadonlyMap<number, EntityArray>;
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
  query.listStamp = nextArchetypeStamp();
}

/** Remove an archetype from a query's sorted archetype list if it is listed. */
function unlistArchetype(query: QueryInstance, archetype: Archetype): void {
  const list = query.archetypes;
  const count = query.archetypeCount;
  const position = lowerBound(query, archetype.registryIndex);
  if (position >= count || list[position] !== archetype) return;
  for (let i = position; i < count - 1; i++) list[i] = list[i + 1]!;
  query.archetypeCount = count - 1;
  query.listStamp = nextArchetypeStamp();
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

  /** Slot -> dense-list position, shared by every archetype (an entity inhabits one archetype at a time) */
  readonly #positions: EntityArray;

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
      oldArchetype.removeSlot(slot);
      if (oldArchetype.getPopulationCount() === 0) this.#tracker.markEmptied(oldArchetype);
    }
    archetype.addSlot(slot);
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
      archetype = new Archetype(
        this.#capacity,
        components,
        bitfield,
        this.#packSlot,
        this.#componentCount,
        this.#positions,
      );
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
   * Rebuild query membership from scratch for the given queries.
   * @param queries - Dense query list whose archetype membership should be rebuilt
   */
  #rebuildQueryMembership(queries: QueryInstanceList): void {
    const queryArray = queries.queries;
    const queryCount = queries.count;
    const stamp = nextArchetypeStamp();
    for (let q = 0; q < queryCount; q++) {
      const query = queryArray[q]!;
      query.archetypeCount = 0;
      query.listStamp = stamp;
    }

    const archetypes = this.#archetypes;
    const archetypeCount = this.#archetypeCount;
    for (let a = 0; a < archetypeCount; a++) {
      const archetype = archetypes[a]!;
      if (archetype.getPopulationCount() === 0) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) query.archetypes[query.archetypeCount++] = archetype;
      }
    }
  }

  /**
   * Add newly populated archetypes to the query lists they match.
   * @param queries - Dense query list to update
   */
  #listPopulatedArchetypes(queries: QueryInstanceList): void {
    const tracker = this.#tracker;
    const queryArray = queries.queries;
    const queryCount = queries.count;
    for (let i = 0; i < tracker.populatedCount; i++) {
      const archetype = tracker.populated[i]!;
      if (archetype.getPopulationCount() === 0) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) listArchetype(query, archetype);
      }
    }
    tracker.clearPopulated();
  }

  /** Bring every registered query's archetype list up to date with archetype populations. */
  #reconcileMembership(queries: QueryInstanceList): void {
    if (this.#membershipRebuildRequired) {
      this.#rebuildQueryMembership(queries);
      this.#membershipRebuildRequired = false;
      this.#tracker.clearPopulated();
      this.#tracker.clearEmptied();
      return;
    }
    if (this.#tracker.populatedCount > 0) this.#listPopulatedArchetypes(queries);
    if (this.#tracker.emptiedCount > 0) this.#unlistEmptiedArchetypes(queries);
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
    this.#positions = createSlotArray(capacity);
    this.#batchMove = new ArchetypeBatchMove(capacity, this.#window, this.#tracker);
    this.#getTransitionForBatch = (from, component, isAdd) => this.#getTransitionArchetype(from, component, isAdd);

    // Create root archetype with properly sized bitfield for components
    const rootBitfield = new BooleanArray(componentCount);
    this.root = new Archetype(capacity, [], rootBitfield, packSlot, componentCount, this.#positions);
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
      archetype.removeSlot(slot);
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
   * @returns this
   */
  registerQuery(query: QueryInstance, _retainTransitions?: boolean): this {
    const list = this.#singleQueryList;
    list.queries[0] = query;
    list.count = 1;
    this.#rebuildQueryMembership(list);
    return this;
  }

  /**
   * Run routine maintenance on the ArchetypeManager
   * @param queries - The registered query instances
   * @param retainTransitions - Keep the current entered/exited window open if true
   * @returns this
   */
  refresh(queries: QueryInstanceList, retainTransitions: boolean = false): this {
    this.#reconcileMembership(queries);
    if (!retainTransitions) this.#window.clear();
    return this;
  }

  /**
   * Reconcile query-to-archetype mappings with archetypes whose emptiness changed since the last call.
   * Only those archetypes are visited; a full rebuild happens only when required.
   * @param queries - The registered query instances
   * @returns this
   */
  ensureQueryMembership(queries: QueryInstanceList, _retainTransitions?: boolean): this {
    this.#reconcileMembership(queries);
    return this;
  }

  /** The current refresh window's per-slot origins. */
  get transitionWindow(): TransitionWindow {
    return this.#window;
  }

  /** Archetype currently inhabited by a raw storage slot (`undefined` when the slot is free). */
  archetypeAtSlot(slot: number): Archetype | undefined {
    return this.entityArchetypes[slot];
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
    const index = archetype.registryIndex;
    if (index < 0 || index >= this.#archetypeCount || this.#archetypes[index] !== archetype) {
      throw new NotRegisteredError("Invalid archetype.");
    }
    const slot = entityIndex(entity);
    this.#requireEntitySlot(entity, slot);
    if (slot >= this.entityArchetypes.length || slot < 0) {
      throw new EntityNotFoundError("Invalid entity.");
    }

    const currentArchetype = this.entityArchetypes[slot];
    if (currentArchetype === archetype) return archetype;

    this.#window.touch(slot, currentArchetype);
    if (currentArchetype !== undefined) {
      currentArchetype.removeSlot(slot);
      if (currentArchetype.getPopulationCount() === 0) this.#tracker.markEmptied(currentArchetype);
    }
    this.entityArchetypes[slot] = archetype;
    archetype.addSlot(slot);
    if (archetype.getPopulationCount() === 1) this.#tracker.markPopulated(archetype);
    return archetype;
  }

  /** Capture archetype populations (in iteration order) and the transition window for rollback. */
  captureState(): ArchetypeManagerSnapshot {
    const populations = new Map<number, EntityArray>();
    for (let i = 0; i < this.#archetypeCount; i++) {
      const archetype = this.#archetypes[i]!;
      if (archetype.getPopulationCount() > 0) populations.set(i, archetype.capturePopulation());
    }
    return { archetypeCount: this.#archetypeCount, populations, window: this.#window.capture() };
  }

  /**
   * Restore a {@link captureState} snapshot exactly: archetypes created after capture are dropped so registry
   * order, query archetype order, and per-archetype iteration order all match the captured world.
   */
  restoreState(snapshot: ArchetypeManagerSnapshot): void {
    this.#forgetPopulations();
    const keep = snapshot.archetypeCount;
    this.#truncateRegistry(keep);
    for (let i = 0; i < keep; i++) this.#restorePopulation(this.#archetypes[i]!, snapshot.populations.get(i));
    this.#window.restore(snapshot.window);
    this.#membershipRebuildRequired = true;
  }

  /** Clear the transition tracker and every archetype's population (and its slots in the entity table). */
  #forgetPopulations(): void {
    this.#tracker.clearPopulated();
    this.#tracker.clearEmptied();
    // Every mapped slot sits in exactly one archetype's population, so clearing populations clears the table
    // in O(live entities) rather than O(capacity).
    for (let i = 0; i < this.#archetypeCount; i++) this.#archetypes[i]!.forgetSlots(this.entityArchetypes);
  }

  /** Drop archetypes registered at index `keep` and later, with the cached edges that lead to them. */
  #truncateRegistry(keep: number): void {
    if (keep >= this.#archetypeCount) return;
    for (let i = keep; i < this.#archetypeCount; i++) {
      this.registry.delete(this.#archetypes[i]!.id);
      this.#archetypes[i] = undefined as unknown as Archetype;
    }
    for (let i = 0; i < keep; i++) {
      const archetype = this.#archetypes[i]!;
      pruneEdges(archetype.addTransitions, keep);
      pruneEdges(archetype.removeTransitions, keep);
    }
    this.#archetypeCount = keep;
  }

  /** Install an archetype's population (empty when `undefined`) and map its slots to it. */
  #restorePopulation(archetype: Archetype, population: EntityArray | undefined): void {
    if (population === undefined || population.length === 0) {
      archetype.clearPopulation();
      return;
    }
    archetype.restorePopulation(population);
    for (let p = 0; p < population.length; p++) this.entityArchetypes[population[p]!] = archetype;
  }
  /** Number of registered archetypes. @internal */
  get archetypeCount(): number {
    return this.#archetypeCount;
  }

  /** The archetype at a registry index below {@link archetypeCount}. @internal */
  archetypeAt(index: number): Archetype {
    return this.#archetypes[index]!;
  }

  /**
   * Number of leading registered archetypes whose component sets equal the saved ones; {@link restoreSaved} keeps them.
   * @param bits - Component bitsets of the saved archetypes, `wordsPerSet` words each, in registry order
   * @param wordsPerSet - Words per bitset
   * @param count - Number of saved archetypes
   * @internal
   */
  savedPrefix(bits: Uint32Array, wordsPerSet: number, count: number): number {
    const limit = Math.min(count, this.#archetypeCount);
    let keep = 0;
    while (keep < limit && sameWords(this.#archetypes[keep]!.bitfield.buffer, bits, keep * wordsPerSet, wordsPerSet)) {
      keep++;
    }
    return keep;
  }

  /**
   * Replace archetype state with a validated world save.
   *
   * The longest prefix of the current registry whose component sets match the save is kept, with its cached edges;
   * the rest is dropped and re-registered in saved order. Registry order, query archetype order and per-archetype
   * iteration order then all match the saved world, and repeated loads of similar saves reuse their archetypes.
   * Entity generations must already be restored, because populations pack their handles.
   * @param instances - Component instances by instance id
   * @param bits - Component bitsets of every saved archetype, `wordsPerSet` words each, in registry order
   * @param wordsPerSet - Words per bitset
   * @param populations - Dense population of every saved archetype, in iteration order
   * @param window - Touched slots in first-touch order, origin registry indices plus one (0 = none), and handles
   * @internal
   */
  restoreSaved(
    instances: readonly DynamicComponentInstance[],
    bits: Uint32Array,
    wordsPerSet: number,
    populations: readonly EntityArray[],
    window: {
      readonly slots: ArrayLike<number>;
      readonly origins: ArrayLike<number>;
      readonly handles: ArrayLike<number>;
    },
  ): void {
    this.#forgetPopulations();
    const count = populations.length;
    const keep = this.savedPrefix(bits, wordsPerSet, count);
    this.#truncateRegistry(keep);
    const componentCount = this.#componentCount;
    for (let i = keep; i < count; i++) {
      const bitfield = new BooleanArray(componentCount);
      const components: DynamicComponentInstance[] = [];
      const offset = i * wordsPerSet;
      for (let id = 0; id < componentCount; id++) {
        if (((bits[offset + (id >>> 5)]! >>> (id & 31)) & 1) === 0) continue;
        bitfield.set(id, true);
        components.push(instances[id]!);
      }
      const archetype = new Archetype(
        this.#capacity,
        components,
        bitfield,
        this.#packSlot,
        componentCount,
        this.#positions,
      );
      this.#registerArchetype(archetype.id, archetype);
    }

    for (let i = 0; i < count; i++) this.#restorePopulation(this.#archetypes[i]!, populations[i]!);

    const touched = window.slots.length;
    const origins = new Array<Archetype | undefined>(touched);
    for (let i = 0; i < touched; i++) {
      const origin = window.origins[i]!;
      origins[i] = origin === 0 ? undefined : this.#archetypes[origin - 1];
    }
    this.#window.restore({ slots: window.slots, origins, handles: window.handles });
    this.#membershipRebuildRequired = true;
  }
}

/** Whether a bitfield's words equal `length` words of `bits` starting at `offset`. */
function sameWords(words: Uint32Array, bits: Uint32Array, offset: number, length: number): boolean {
  if (words.length !== length) return false;
  for (let i = 0; i < length; i++) if (words[i] !== bits[offset + i]) return false;
  return true;
}

/** Forget cached transition edges that lead to archetypes dropped by a rollback. */
function pruneEdges(edges: Archetype[], keep: number): void {
  for (let i = 0; i < edges.length; i++) {
    const target = edges[i];
    if (target !== undefined && target.registryIndex >= keep) edges[i] = undefined as unknown as Archetype;
  }
}
