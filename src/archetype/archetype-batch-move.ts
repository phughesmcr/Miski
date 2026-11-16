import { createSlotArray, type EntityArray } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { Archetype } from "./archetype.ts";
import type { MembershipTracker } from "./membership-tracker.ts";
import type { TransitionWindow } from "./transition-window.ts";

/** Resolves the archetype reached by adding or removing one component. */
export type TransitionArchetypeGetter = (
  from: Archetype,
  instance: DynamicComponentInstance,
  add: boolean,
) => Archetype;

/**
 * Owns reusable scratch buffers for batch single-component archetype transitions.
 * Used by {@link ArchetypeManager} for `addComponents` / `removeComponents`.
 *
 * Group lists keep capacity across calls - never truncate with `.length = 0`, which
 * reallocates V8 elements backing stores on the hot path.
 */
export class ArchetypeBatchMove {
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

  /** Records each moved slot's window-start archetype */
  #window: TransitionWindow;

  /** Records archetypes whose population crossed the empty boundary */
  #tracker: MembershipTracker;

  constructor(capacity: number, window: TransitionWindow, tracker: MembershipTracker) {
    this.#window = window;
    this.#tracker = tracker;
    this.#bulkSlots = createSlotArray(capacity);
    this.#bulkGroupCounts = [];
    this.#bulkGroupOffsets = [];
    this.#bulkGroupWrites = [];
    this.#bulkSources = [];
    this.#bulkTargets = [];
  }

  /**
   * Move a dense slot list through a single-component transition grouped by source archetype.
   * @param entityArchetypes - Archetypes indexed by entity storage slot
   * @param root - Fallback archetype when a slot has no mapping yet
   * @param getTransitionArchetype - Resolves the add/remove transition target
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being added or removed
   * @param add - Whether the component is being added
   * @returns The number of entities moved to a different archetype
   */
  moveEntities(
    entityArchetypes: Array<Archetype | undefined>,
    root: Archetype,
    getTransitionArchetype: TransitionArchetypeGetter,
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
    let groupCount = 0;
    let moved = 0;

    // Group by source archetype in first-seen order. Each source remembers its group in `batchGroup`; the
    // index only counts when `sources` points back at it, so a stale value (e.g. after a throw) is ignored.
    // Sources the transition leaves in place get no group and are re-resolved through their cached edge.
    try {
      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const source = entityArchetypes[slot] ?? root;
        let group = source.batchGroup;
        if (group < 0 || group >= groupCount || sources[group] !== source) {
          const target = getTransitionArchetype(source, instance, add);
          if (source === target) continue;
          group = groupCount++;
          source.batchGroup = group;
          sources[group] = source;
          targets[group] = target;
          counts[group] = 0;
        }
        counts[group]!++;
      }

      for (let group = 0; group < groupCount; group++) {
        offsets[group] = moved;
        writes[group] = moved;
        moved += counts[group]!;
      }
      if (moved === 0) {
        return 0;
      }

      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const source = entityArchetypes[slot] ?? root;
        const group = source.batchGroup;
        if (group < 0 || group >= groupCount || sources[group] !== source) continue;
        const write = writes[group]!;
        this.#bulkSlots[write] = slot;
        writes[group] = write + 1;
      }
    } finally {
      for (let group = 0; group < groupCount; group++) sources[group]!.batchGroup = -1;
    }

    for (let group = 0; group < groupCount; group++) {
      const source = sources[group]!;
      const target = targets[group]!;
      const offset = offsets[group]!;
      const groupSize = counts[group] ?? 0;
      const end = offset + groupSize;
      for (let i = offset; i < end; i++) {
        this.#window.touch(this.#bulkSlots[i]!, source);
      }
      source.removeEntities(this.#bulkSlots, offset, groupSize);
      if (source.getPopulationCount() === 0) this.#tracker.markEmptied(source);
      const targetWasEmpty = target.getPopulationCount() === 0;
      target.addEntities(this.#bulkSlots, offset, groupSize);
      if (targetWasEmpty) this.#tracker.markPopulated(target);
      for (let i = offset; i < end; i++) {
        entityArchetypes[this.#bulkSlots[i]!] = target;
      }
      counts[group] = 0;
      offsets[group] = 0;
      writes[group] = 0;
    }

    return moved;
  }
}
