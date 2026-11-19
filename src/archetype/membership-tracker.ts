import type { Archetype } from "./archetype.ts";

/**
 * Collects the archetypes whose population crossed the empty boundary since query membership
 * was last reconciled, so reconciliation touches those archetypes instead of every archetype.
 *
 * - `populated`: went from empty to non-empty and may need adding to matching query lists.
 * - `emptied`: went from non-empty to empty and may need pruning from matching query lists.
 *
 * Both lists are deduplicated through flags on the archetype and keep their capacity across calls.
 * {@link rebuildRequired} replaces both when the registry itself was rewritten (first use, rollback, load).
 */
export class MembershipTracker {
  readonly populated: Archetype[] = [];
  populatedCount = 0;

  readonly emptied: Archetype[] = [];
  emptiedCount = 0;

  /** Whether every query's archetype list must be rebuilt from scratch rather than patched. */
  rebuildRequired = true;

  /** Record that an archetype just received its first entity. */
  markPopulated(archetype: Archetype): void {
    if (archetype.populatedPending) return;
    archetype.populatedPending = true;
    this.populated[this.populatedCount++] = archetype;
  }

  /** Record that an archetype just lost its last entity. */
  markEmptied(archetype: Archetype): void {
    if (archetype.emptiedPending) return;
    archetype.emptiedPending = true;
    this.emptied[this.emptiedCount++] = archetype;
  }

  /** Forget every pending population entry. */
  clearPopulated(): void {
    for (let i = 0; i < this.populatedCount; i++) {
      this.populated[i]!.populatedPending = false;
    }
    this.populatedCount = 0;
  }

  /** Forget every pending emptied entry. */
  clearEmptied(): void {
    for (let i = 0; i < this.emptiedCount; i++) {
      this.emptied[i]!.emptiedPending = false;
    }
    this.emptiedCount = 0;
  }

  /** Drop pending entries and ask for a full rebuild (the archetype registry was rewritten). */
  requireRebuild(): void {
    this.clear();
    this.rebuildRequired = true;
  }

  /** Drop pending entries and the rebuild request (membership is current). */
  clear(): void {
    this.clearPopulated();
    this.clearEmptied();
    this.rebuildRequired = false;
  }
}
