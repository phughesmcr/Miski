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
 * The minimal dense entity list shape accepted by batch mutation APIs.
 *
 * Anywhere this type appears as an input, a plain `{ count, indices }` object
 * is sufficient; iteration support is not required.
 */
export type QueryEntityList = {
  /** Number of valid entity IDs in {@link QueryEntityList.indices}. */
  readonly count: number;
  /** Borrowed dense entity IDs. Read only entries `0 <= i < count`. */
  readonly indices: BorrowedEntityIndices;
};

/**
 * A borrowed, reusable view of entity IDs.
 *
 * The view is pooled and valid only until the next world mutation, query
 * invalidation, or `world.refresh()`. Copy the valid prefix when a stable
 * snapshot is required.
 *
 * Iterable for convenience (`for (const entity of list)`); use the
 * `count`/`indices` pair directly in hot loops to avoid iterator overhead.
 */
export type BorrowedEntityList = QueryEntityList & {
  /** Iterate the valid entity IDs `0 <= i < count`. */
  [Symbol.iterator](): IterableIterator<Entity>;
};
