/**
 * @module      types/entity-views
 * @description Borrowed entity view type definitions.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Entity } from "@/entity/entity-id.ts";

/** A borrowed, reusable entity iterator. */
export type BorrowedEntityIterator = IterableIterator<Entity>;

/** Read-only numeric index view for borrowed entity IDs. */
export type BorrowedEntityIndices = {
  /** Dense entity ID at `index`; only entries before the owning list's `count` are valid. */
  readonly [index: number]: Entity;
};

/**
 * A borrowed, reusable view of entity IDs.
 *
 * The view is pooled and valid only until the next world mutation, query
 * invalidation, or `world.refresh()`. Copy the valid prefix when a stable
 * snapshot is required.
 */
export type BorrowedEntityList = {
  /** Number of valid entity IDs in {@link BorrowedEntityList.indices}. */
  readonly count: number;
  /** Borrowed dense entity IDs. Read only entries `0 <= i < count`. */
  readonly indices: BorrowedEntityIndices;
};

/** Backwards-compatible name for the borrowed dense query result. */
export type QueryEntityList = BorrowedEntityList;
