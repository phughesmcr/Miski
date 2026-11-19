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
import { type Archetype, ArchetypeClock } from "./archetype.ts";
import { ArchetypeBatchMove } from "./archetype-batch-move.ts";
import { ArchetypeGraph } from "./archetype-graph.ts";
import { type ArchetypeManagerSnapshot, ArchetypeSnapshots, type SavedTransitionWindow } from "./archetype-snapshot.ts";
import { MembershipTracker } from "./membership-tracker.ts";
import { TransitionWindow } from "./transition-window.ts";

export type { ArchetypeManagerSnapshot };

/**
 * ArchetypeManager tracks which archetype each storage slot inhabits and moves slots between archetypes.
 *
 * Every move goes through one relocation step, which records the slot's window-start archetype and any
 * archetype whose population crossed the empty boundary. The archetype registry and its transition edges live in
 * {@link ArchetypeGraph}, rollback and load in {@link ArchetypeSnapshots}, and query archetype lists in
 * `QueryMembership` (`src/query/query-membership.ts`), which reads {@link tracker}.
 *
 * The single-entity transitions ({@link addComponent}, {@link removeComponent}, {@link addComponentSet}) and the
 * batch ones expect live entities; their callers check liveness first. {@link set} and {@link destroyEntity}
 * check it themselves.
 */
export class ArchetypeManager {
  /** This world's structural change clock, shared by its archetypes and query lists. */
  readonly clock: ArchetypeClock = new ArchetypeClock();

  /** Archetypes whose population crossed the empty boundary since query membership was last reconciled. */
  readonly tracker: MembershipTracker = new MembershipTracker();

  /** Archetype each storage slot inhabits (`undefined` = free slot). */
  readonly #slotArchetypes: Array<Archetype | undefined>;

  /** Archetype registry and transition edges. */
  readonly #graph: ArchetypeGraph;

  /** Archetype each slot occupied when the current refresh window began. */
  readonly #window: TransitionWindow;

  /** Batch single-component transition grouping. */
  readonly #batch: ArchetypeBatchMove;

  /** Rollback capture/restore and world-save restore. */
  readonly #snapshots: ArchetypeSnapshots;

  /** The maximum number of entities this manager can handle. */
  readonly #capacity: number;

  /** Packs a live slot into its current entity handle. */
  readonly #packSlot: PackSlot;

  /** One-slot scratch list for single-entity relocations. */
  readonly #single: EntityArray;

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
    this.#slotArchetypes = new Array(capacity);
    this.#single = createSlotArray(capacity, 1);
    this.#window = new TransitionWindow(capacity, packSlot);
    this.#graph = new ArchetypeGraph(capacity, componentCount, packSlot, createSlotArray(capacity), this.clock);
    this.#batch = new ArchetypeBatchMove(capacity);
    this.#snapshots = new ArchetypeSnapshots(this.#graph, this.#slotArchetypes, this.#window, this.tracker);
  }

  /** Entities in this archetype have no components. */
  get root(): Archetype {
    return this.#graph.root;
  }

  /** Number of registered archetypes. @internal */
  get archetypeCount(): number {
    return this.#graph.count;
  }

  /** The archetype at a registry index below {@link archetypeCount}. @internal */
  archetypeAt(index: number): Archetype {
    return this.#graph.at(index);
  }

  /** The current refresh window's per-slot origins. */
  get transitionWindow(): TransitionWindow {
    return this.#window;
  }

  /** Throw unless `entity` is the live handle of `slot`. */
  #requireLiveSlot(entity: Entity, slot: number): void {
    if (slot >= this.#capacity || this.#packSlot(slot) !== entity) {
      throw new EntityNotFoundError(formatEntityNotActive(entity));
    }
  }

  /**
   * Move `slots[start..end)` from one archetype to another, recording their window origins and any emptiness
   * change. Every archetype move goes through here.
   * @param slots - Storage slots, all currently in `from`
   * @param start - First index to read
   * @param end - Index after the last one to read
   * @param from - The archetype the slots leave (`undefined` for new entities)
   * @param to - The archetype the slots join (`undefined` for destroyed entities)
   */
  #relocate(
    slots: EntityArray,
    start: number,
    end: number,
    from: Archetype | undefined,
    to: Archetype | undefined,
  ): void {
    const window = this.#window;
    for (let i = start; i < end; i++) window.touch(slots[i]!, from);
    if (from !== undefined) {
      for (let i = start; i < end; i++) from.removeSlot(slots[i]!);
      if (from.getPopulationCount() === 0) this.tracker.markEmptied(from);
    }
    const table = this.#slotArchetypes;
    if (to !== undefined) {
      const wasEmpty = to.getPopulationCount() === 0;
      to.reserve(to.getPopulationCount() + end - start);
      for (let i = start; i < end; i++) to.addSlot(slots[i]!);
      if (wasEmpty && to.getPopulationCount() !== 0) this.tracker.markPopulated(to);
    }
    for (let i = start; i < end; i++) table[slots[i]!] = to;
  }

  /** Relocate one slot to `archetype` unless it is already there. */
  #moveSlot(slot: number, archetype: Archetype): Archetype {
    const current = this.#slotArchetypes[slot];
    if (current !== archetype) {
      const single = this.#single;
      single[0] = slot;
      this.#relocate(single, 0, 1, current, archetype);
    }
    return archetype;
  }

  /**
   * Move a dense slot list through a single-component transition, grouped by source archetype.
   * @returns The number of slots moved to a different archetype
   */
  #moveSlots(slots: EntityArray, count: number, instance: DynamicComponentInstance, add: boolean): number {
    const batch = this.#batch;
    const groupCount = batch.group(this.#slotArchetypes, this.#graph, slots, count, instance, add);
    let moved = 0;
    for (let group = 0; group < groupCount; group++) {
      const start = batch.offsets[group]!;
      const end = start + batch.counts[group]!;
      this.#relocate(batch.slots, start, end, batch.sources[group]!, batch.targets[group]!);
      moved += end - start;
    }
    return moved;
  }

  /**
   * Move a live entity to the archetype reached by adding a component.
   * @param entity - The entity to move
   * @param instance - The component instance being added
   * @param slot - The entity's storage slot
   * @returns The target archetype
   */
  addComponent(entity: Entity, instance: DynamicComponentInstance, slot: number = entityIndex(entity)): Archetype {
    const from = this.#slotArchetypes[slot] ?? this.#graph.root;
    return this.#moveSlot(slot, this.#graph.transition(from, instance, true));
  }

  /**
   * Move live entities' slots to the archetypes reached by adding a component.
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being added
   * @returns The number of slots moved to a different archetype
   */
  addComponents(slots: EntityArray, count: number, instance: DynamicComponentInstance): number {
    return this.#moveSlots(slots, count, instance, true);
  }

  /**
   * Move a live entity once to the archetype reached by adding a component set.
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
    const from = this.#slotArchetypes[slot] ?? this.#graph.root;
    return this.#moveSlot(slot, this.#graph.transitionAddingSet(from, instances, count));
  }

  /** Add a newly-created active entity to the root archetype. */
  createEntity(entity: Entity): Archetype {
    return this.set(this.#graph.root, entity);
  }

  /**
   * Called by `world.destroy()`
   *
   * Destroy the ArchetypeManager
   * @returns this
   */
  destroy(): this {
    this.#graph.clear();
    this.#slotArchetypes.length = 0;
    return this;
  }

  /** Remove a destroyed entity from whichever archetype currently owns it. */
  destroyEntity(entity: Entity): this {
    const slot = entityIndex(entity);
    this.#requireLiveSlot(entity, slot);
    const archetype = this.#slotArchetypes[slot];
    if (archetype !== undefined) {
      const single = this.#single;
      single[0] = slot;
      this.#relocate(single, 0, 1, archetype, undefined);
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
    return this.#slotArchetypes[slot];
  }

  /**
   * Check if an Entity is in the root archetype
   * @param entity The Entity
   * @returns `true` if the Entity is in the root archetype, `false` otherwise
   */
  isEntityInRoot(entity: Entity): boolean {
    return this.getEntityArchetype(entity) === this.#graph.root;
  }

  /**
   * End the current refresh window.
   * @param retainTransitions - Keep the current entered/exited window open if true
   * @returns this
   */
  refresh(retainTransitions: boolean = false): this {
    if (!retainTransitions) this.#window.clear();
    return this;
  }

  /** Archetype currently inhabited by a raw storage slot (`undefined` when the slot is free). */
  archetypeAtSlot(slot: number): Archetype | undefined {
    return this.#slotArchetypes[slot];
  }

  /**
   * Move a live entity to the archetype reached by removing a component.
   * @param entity - The entity to move
   * @param instance - The component instance being removed
   * @param slot - The entity's storage slot
   * @returns The target archetype
   */
  removeComponent(entity: Entity, instance: DynamicComponentInstance, slot: number = entityIndex(entity)): Archetype {
    const from = this.#slotArchetypes[slot] ?? this.#graph.root;
    return this.#moveSlot(slot, this.#graph.transition(from, instance, false));
  }

  /**
   * Move live entities' slots to the archetypes reached by removing a component.
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being removed
   * @returns The number of slots moved to a different archetype
   */
  removeComponents(slots: EntityArray, count: number, instance: DynamicComponentInstance): number {
    return this.#moveSlots(slots, count, instance, false);
  }

  /**
   * Set the Archetype associated with an Entity
   * @param archetype The Archetype
   * @param entity The Entity
   * @returns The Archetype
   * @throws {NotRegisteredError} If the Archetype is not registered
   * @throws {EntityNotFoundError} If the Entity is not live
   */
  set(archetype: Archetype, entity: Entity): Archetype {
    if (!this.#graph.holds(archetype)) throw new NotRegisteredError("Invalid archetype.");
    const slot = entityIndex(entity);
    this.#requireLiveSlot(entity, slot);
    return this.#moveSlot(slot, archetype);
  }

  /** Capture archetype populations (in iteration order) and the transition window for rollback. */
  captureState(): ArchetypeManagerSnapshot {
    return this.#snapshots.capture();
  }

  /**
   * Restore a {@link captureState} snapshot exactly: archetypes created after capture are dropped so registry
   * order, query archetype order, and per-archetype iteration order all match the captured world.
   */
  restoreState(snapshot: ArchetypeManagerSnapshot): void {
    this.#snapshots.restore(snapshot);
  }

  /**
   * Number of leading registered archetypes whose component sets equal the saved ones; {@link restoreSaved} keeps them.
   * @param bits - Component bitsets of the saved archetypes, `wordsPerSet` words each, in registry order
   * @param wordsPerSet - Words per bitset
   * @param count - Number of saved archetypes
   * @internal
   */
  savedPrefix(bits: Uint32Array, wordsPerSet: number, count: number): number {
    return this.#graph.savedPrefix(bits, wordsPerSet, count);
  }

  /**
   * Replace archetype state with a validated world save (see {@link ArchetypeSnapshots.restoreSaved}).
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
    window: SavedTransitionWindow,
  ): void {
    this.#snapshots.restoreSaved(instances, bits, wordsPerSet, populations, window);
  }
}
