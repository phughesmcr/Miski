import { createSlotArray, type EntityArray } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { Archetype } from "./archetype.ts";
import type { ArchetypeGraph } from "./archetype-graph.ts";

/**
 * Groups a dense slot list by source archetype for a single-component transition, so each group resolves its
 * target archetype once. Used by {@link ArchetypeManager} for `addComponents` / `removeComponents`, which then
 * relocates each grouped slot.
 *
 * After {@link group} returns `n`, group `g < n` moves `counts[g]` slots, `slots[offsets[g]]` onwards, from
 * `sources[g]` to `targets[g]`. Groups are in first-seen order and keep each source's slot order.
 *
 * Group lists keep capacity across calls - never truncate with `.length = 0`, which
 * reallocates V8 elements backing stores on the hot path.
 */
export class ArchetypeBatchMove {
  /** Grouped slots; group `g` occupies `[offsets[g], offsets[g] + counts[g])`. */
  readonly slots: EntityArray;

  /** Slot count of each group. */
  readonly counts: number[] = [];

  /** First index of each group in {@link slots}. */
  readonly offsets: number[] = [];

  /** Source archetype of each group. */
  readonly sources: Archetype[] = [];

  /** Target archetype of each group. */
  readonly targets: Archetype[] = [];

  /** Next write index of each group while filling {@link slots}. */
  readonly #writes: number[] = [];

  /** @param capacity - The world's entity capacity */
  constructor(capacity: number) {
    this.slots = createSlotArray(capacity);
  }

  /**
   * Group a dense slot list by source archetype, skipping slots the transition leaves in place.
   * @param slotArchetypes - Archetypes indexed by storage slot
   * @param graph - Resolves (and caches) each source's transition target
   * @param slots - Dense storage slots
   * @param count - Number of slots to read
   * @param instance - The component instance being added or removed
   * @param add - Whether the component is being added
   * @returns The number of groups
   */
  group(
    slotArchetypes: ReadonlyArray<Archetype | undefined>,
    graph: ArchetypeGraph,
    slots: EntityArray,
    count: number,
    instance: DynamicComponentInstance,
    add: boolean,
  ): number {
    if (count === 0) return 0;

    const root = graph.root;
    const sources = this.sources;
    const targets = this.targets;
    const counts = this.counts;
    const offsets = this.offsets;
    const writes = this.#writes;
    let groupCount = 0;

    // Group by source archetype in first-seen order. Each source remembers its group in `batchGroup`; the
    // index only counts when `sources` points back at it, so a stale value (e.g. after a throw) is ignored.
    // Sources the transition leaves in place get no group and are re-resolved through their cached edge.
    try {
      for (let i = 0; i < count; i++) {
        const source = slotArchetypes[slots[i]!] ?? root;
        let group = source.batchGroup;
        if (group < 0 || group >= groupCount || sources[group] !== source) {
          const target = graph.transition(source, instance, add);
          if (source === target) continue;
          group = groupCount++;
          source.batchGroup = group;
          sources[group] = source;
          targets[group] = target;
          counts[group] = 0;
        }
        counts[group]!++;
      }

      let moved = 0;
      for (let group = 0; group < groupCount; group++) {
        offsets[group] = moved;
        writes[group] = moved;
        moved += counts[group]!;
      }
      if (moved === 0) return 0;

      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const source = slotArchetypes[slot] ?? root;
        const group = source.batchGroup;
        if (group < 0 || group >= groupCount || sources[group] !== source) continue;
        const write = writes[group]!;
        this.slots[write] = slot;
        writes[group] = write + 1;
      }
    } finally {
      for (let group = 0; group < groupCount; group++) sources[group]!.batchGroup = -1;
    }
    return groupCount;
  }
}
