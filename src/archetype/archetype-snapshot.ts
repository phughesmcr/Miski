import type { EntityArray } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { Archetype } from "./archetype.ts";
import type { ArchetypeGraph } from "./archetype-graph.ts";
import type { MembershipTracker } from "./membership-tracker.ts";
import type { TransitionWindow, TransitionWindowSnapshot } from "./transition-window.ts";

/** Rollback copy of archetype populations (in iteration order) and per-entity window origins. */
export type ArchetypeManagerSnapshot = {
  /** Number of archetypes registered at capture; later ones are speculative and dropped on restore. */
  readonly archetypeCount: number;
  /** Dense population of each non-empty archetype, keyed by registry index. */
  readonly populations: ReadonlyMap<number, EntityArray>;
  readonly window: TransitionWindowSnapshot;
};

/** The transition window of a world save: touched slots, origin registry indices plus one (0 = none), handles. */
export type SavedTransitionWindow = {
  readonly slots: ArrayLike<number>;
  readonly origins: ArrayLike<number>;
  readonly handles: ArrayLike<number>;
};

/**
 * Captures and restores a world's archetype state: registry, populations, slot table and transition window.
 *
 * Restores keep registry order, query archetype order and per-archetype iteration order identical to the
 * captured (or saved) world, then ask query membership for a full rebuild.
 */
export class ArchetypeSnapshots {
  readonly #graph: ArchetypeGraph;
  readonly #slotArchetypes: Array<Archetype | undefined>;
  readonly #window: TransitionWindow;
  readonly #tracker: MembershipTracker;

  /**
   * @param graph - The world's archetype registry
   * @param slotArchetypes - Archetype of each storage slot (`undefined` = free slot)
   * @param window - The world's transition window
   * @param tracker - The world's query membership tracker
   */
  constructor(
    graph: ArchetypeGraph,
    slotArchetypes: Array<Archetype | undefined>,
    window: TransitionWindow,
    tracker: MembershipTracker,
  ) {
    this.#graph = graph;
    this.#slotArchetypes = slotArchetypes;
    this.#window = window;
    this.#tracker = tracker;
  }

  /** Capture archetype populations (in iteration order) and the transition window for rollback. */
  capture(): ArchetypeManagerSnapshot {
    const graph = this.#graph;
    const populations = new Map<number, EntityArray>();
    for (let i = 0; i < graph.count; i++) {
      const archetype = graph.at(i);
      if (archetype.getPopulationCount() > 0) populations.set(i, archetype.capturePopulation());
    }
    return { archetypeCount: graph.count, populations, window: this.#window.capture() };
  }

  /**
   * Restore a {@link capture} snapshot exactly: archetypes created after capture are dropped so registry
   * order, query archetype order, and per-archetype iteration order all match the captured world.
   */
  restore(snapshot: ArchetypeManagerSnapshot): void {
    this.#forgetPopulations();
    const keep = snapshot.archetypeCount;
    this.#graph.truncate(keep);
    for (let i = 0; i < keep; i++) this.#restorePopulation(this.#graph.at(i), snapshot.populations.get(i));
    this.#window.restore(snapshot.window);
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
   * @param window - The saved transition window
   */
  restoreSaved(
    instances: readonly DynamicComponentInstance[],
    bits: Uint32Array,
    wordsPerSet: number,
    populations: readonly EntityArray[],
    window: SavedTransitionWindow,
  ): void {
    const graph = this.#graph;
    this.#forgetPopulations();
    const count = populations.length;
    const keep = graph.savedPrefix(bits, wordsPerSet, count);
    graph.truncate(keep);
    for (let i = keep; i < count; i++) graph.createFromBits(instances, bits, i * wordsPerSet);
    for (let i = 0; i < count; i++) this.#restorePopulation(graph.at(i), populations[i]!);

    const touched = window.slots.length;
    const origins = new Array<Archetype | undefined>(touched);
    for (let i = 0; i < touched; i++) {
      const origin = window.origins[i]!;
      origins[i] = origin === 0 ? undefined : graph.at(origin - 1);
    }
    this.#window.restore({ slots: window.slots, origins, handles: window.handles });
  }

  /** Empty every archetype and its slots in the slot table, and ask for a full membership rebuild. */
  #forgetPopulations(): void {
    this.#tracker.requireRebuild();
    // Every mapped slot sits in exactly one archetype's population, so clearing populations clears the table
    // in O(live entities) rather than O(capacity).
    const graph = this.#graph;
    for (let i = 0; i < graph.count; i++) graph.at(i).forgetSlots(this.#slotArchetypes);
  }

  /** Install an archetype's population (empty when `undefined`) and map its slots to it. */
  #restorePopulation(archetype: Archetype, population: EntityArray | undefined): void {
    if (population === undefined || population.length === 0) {
      archetype.clearPopulation();
      return;
    }
    archetype.restorePopulation(population);
    for (let p = 0; p < population.length; p++) this.#slotArchetypes[population[p]!] = archetype;
  }
}
