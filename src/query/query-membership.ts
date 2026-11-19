import type { Archetype, ArchetypeClock } from "@/archetype/archetype.ts";
import type { MembershipTracker } from "@/archetype/membership-tracker.ts";
import type { QueryInstance, QueryInstanceList } from "@/types/query.ts";

/** The archetype state that query membership is derived from. */
export type MembershipSource = {
  /** The world's structural change clock. */
  readonly clock: ArchetypeClock;
  /** Archetypes whose emptiness changed since membership was last reconciled. */
  readonly tracker: MembershipTracker;
  /** Number of registered archetypes. */
  readonly archetypeCount: number;
  /** The archetype at a registry index below {@link archetypeCount}. */
  archetypeAt(index: number): Archetype;
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

/**
 * Keeps each registered query's list of non-empty matching archetypes current.
 *
 * Archetype moves only record which archetypes crossed the empty boundary (in the source's
 * {@link MembershipTracker}); {@link reconcile} visits just those. A full rebuild happens on the first
 * reconcile and after the archetype registry is rewritten (rollback, load).
 */
export class QueryMembership {
  readonly #source: MembershipSource;

  /** Reusable one-query list for {@link register}. */
  readonly #single: { queries: QueryInstance[]; count: number } = { queries: [], count: 0 };

  /** @param source - The world's archetype state */
  constructor(source: MembershipSource) {
    this.#source = source;
  }

  /** List the current non-empty archetypes for one newly registered query. */
  register(query: QueryInstance): void {
    const list = this.#single;
    list.queries[0] = query;
    list.count = 1;
    this.#rebuild(list);
  }

  /** Bring every query's archetype list up to date with archetype populations. */
  reconcile(queries: QueryInstanceList): void {
    const tracker = this.#source.tracker;
    if (tracker.rebuildRequired) {
      this.#rebuild(queries);
      tracker.clear();
      return;
    }
    if (tracker.populatedCount > 0) this.#listPopulated(queries);
    if (tracker.emptiedCount > 0) this.#unlistEmptied(queries);
  }

  /** Rebuild the archetype lists of `queries` from scratch. */
  #rebuild(queries: QueryInstanceList): void {
    const source = this.#source;
    const queryArray = queries.queries;
    const queryCount = queries.count;
    const stamp = source.clock.next();
    for (let q = 0; q < queryCount; q++) {
      const query = queryArray[q]!;
      query.archetypeCount = 0;
      query.listStamp = stamp;
    }

    const archetypeCount = source.archetypeCount;
    for (let a = 0; a < archetypeCount; a++) {
      const archetype = source.archetypeAt(a);
      if (archetype.getPopulationCount() === 0) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) query.archetypes[query.archetypeCount++] = archetype;
      }
    }
  }

  /** Add newly populated archetypes to the query lists they match. */
  #listPopulated(queries: QueryInstanceList): void {
    const tracker = this.#source.tracker;
    const queryArray = queries.queries;
    const queryCount = queries.count;
    for (let i = 0; i < tracker.populatedCount; i++) {
      const archetype = tracker.populated[i]!;
      if (archetype.getPopulationCount() === 0) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) this.#list(query, archetype);
      }
    }
    tracker.clearPopulated();
  }

  /** Drop archetypes that emptied out from the query lists that still hold them. */
  #unlistEmptied(queries: QueryInstanceList): void {
    const tracker = this.#source.tracker;
    const queryArray = queries.queries;
    const queryCount = queries.count;
    for (let i = 0; i < tracker.emptiedCount; i++) {
      const archetype = tracker.emptied[i]!;
      if (archetype.getPopulationCount() !== 0) continue;
      for (let q = 0; q < queryCount; q++) {
        const query = queryArray[q]!;
        if (archetype.isCandidate(query)) this.#unlist(query, archetype);
      }
    }
    tracker.clearEmptied();
  }

  /** Insert an archetype into a query's sorted archetype list if it is not already listed. */
  #list(query: QueryInstance, archetype: Archetype): void {
    const list = query.archetypes;
    const count = query.archetypeCount;
    const position = lowerBound(query, archetype.registryIndex);
    if (position < count && list[position] === archetype) return;
    for (let i = count; i > position; i--) list[i] = list[i - 1]!;
    list[position] = archetype;
    query.archetypeCount = count + 1;
    query.listStamp = this.#source.clock.next();
  }

  /** Remove an archetype from a query's sorted archetype list if it is listed. */
  #unlist(query: QueryInstance, archetype: Archetype): void {
    const list = query.archetypes;
    const count = query.archetypeCount;
    const position = lowerBound(query, archetype.registryIndex);
    if (position >= count || list[position] !== archetype) return;
    for (let i = position; i < count - 1; i++) list[i] = list[i + 1]!;
    query.archetypeCount = count - 1;
    query.listStamp = this.#source.clock.next();
  }
}
