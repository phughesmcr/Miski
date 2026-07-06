/** An Entity is an ID number into world-owned storage. */
export type Entity = number;

/** Integer array type used for dense entity ID lists. */
export type EntityArray = Uint8Array | Uint16Array | Uint32Array;

/** Mutable sink that accepts dense entity IDs during query materialization. */
export type EntityResultSink = {
  add(entity: Entity): void;
};

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

export function createEntityArray(capacity: number, length: number = capacity): EntityArray {
  if (capacity <= 0x100) return new Uint8Array(length);
  if (capacity <= 0x1_0000) return new Uint16Array(length);
  return new Uint32Array(length);
}

export class ReusableEntityIterator implements IterableIterator<Entity> {
  count: number;
  cursor: number;
  indices: EntityArray;
  result: IteratorResult<Entity>;

  constructor(indices: EntityArray) {
    this.indices = indices;
    this.count = 0;
    this.cursor = 0;
    this.result = { value: 0, done: false };
  }

  reset(count: number): this {
    this.count = count;
    this.cursor = 0;
    return this;
  }

  next(): IteratorResult<Entity> {
    if (this.cursor < this.count) {
      this.result.value = this.indices[this.cursor++]!;
      this.result.done = false;
      return this.result;
    }

    this.result.value = undefined as unknown as Entity;
    this.result.done = true;
    return this.result;
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }
}
