/**
 * Packed slot index + generation. Always non-negative and <= `0x7fffffff` so V8
 * can keep handles as SMIs (signed 31-bit ints).
 *
 * Use {@link entityIndex} / {@link entityGeneration} / {@link packEntity} to
 * inspect or construct handles. Prefer {@link SlotIndex} values from query
 * lists for SoA partition access.
 */
export type Entity = number;

/**
 * Raw entity slot index in `[0, capacity)`. Use with partition access and
 * {@link ComponentInstance.getAt} / `setAt` in hot loops.
 */
export type SlotIndex = number;

/** Integer array type used for dense entity/slot ID lists. */
export type EntityArray = Uint8Array | Uint16Array | Uint32Array;

/** Mutable sink that accepts dense entity IDs during query materialization. */
export type EntityResultSink = {
  add(entity: Entity, slot: SlotIndex): void;
};

/** A borrowed, reusable entity iterator. */
export type BorrowedEntityIterator = IterableIterator<Entity>;

/** Read-only numeric index view for borrowed packed entity IDs. */
export type BorrowedEntityIndices = {
  /** Packed entity handle at `index`; only entries before the owning list's `count` are valid. */
  readonly [index: number]: Entity;
};

/** Read-only numeric index view for borrowed slot indices. */
export type BorrowedSlotIndices = {
  /** Slot index at `index`; only entries before the owning list's `count` are valid. */
  readonly [index: number]: SlotIndex;
};

/**
 * The minimal dense entity list shape accepted by batch mutation APIs.
 *
 * Anywhere this type appears as an input, a plain `{ count, entities, indices }`
 * object is sufficient; iteration support is not required.
 *
 * - {@link QueryEntityList.entities}: packed handles for identity / `isActive`
 * - {@link QueryEntityList.indices}: slot indices for partition / storage access
 */
export type QueryEntityList = {
  /** Number of valid entries in {@link QueryEntityList.entities} / {@link QueryEntityList.indices}. */
  readonly count: number;
  /** Borrowed packed entity handles. Read only entries `0 <= i < count`. */
  readonly entities: BorrowedEntityIndices;
  /**
   * Borrowed slot indices for SoA storage access.
   * Prefer `partitions.x[list.indices[i]]` in hot loops.
   */
  readonly indices: BorrowedSlotIndices;
};

/**
 * A borrowed, reusable view of entity IDs.
 *
 * The view is pooled and valid only until the next world mutation, query
 * invalidation, or `world.refresh()`. Copy the valid prefix when a stable
 * snapshot is required.
 *
 * Iterable for convenience (`for (const entity of list)` yields packed handles);
 * use the `count`/`indices` pair directly in hot loops to avoid iterator overhead.
 */
export type BorrowedEntityList = QueryEntityList & {
  /** Iterate the valid packed entity handles `0 <= i < count`. */
  [Symbol.iterator](): IterableIterator<Entity>;
};

// 16 + 15 = 31 bits used; the high bit stays zero so packed handles stay <= 0x7fffffff.
const INDEX_BITS = 16;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GEN_BITS = 15;
const GEN_MASK = (1 << GEN_BITS) - 1;

/** Maximum world / entity-manager capacity (16 index bits). */
export const MAX_WORLD_CAPACITY: number = 1 << INDEX_BITS;

/** Raw slot index encoded in the low bits of a packed entity handle. */
export function entityIndex(entity: Entity | number): number {
  return (entity as number) & INDEX_MASK;
}

/** Generation encoded in the high bits of a packed entity handle. */
export function entityGeneration(entity: Entity | number): number {
  return ((entity as number) >>> INDEX_BITS) & GEN_MASK;
}

/** Pack a slot index and generation into an entity handle (gen is masked to GEN_BITS). */
export function packEntity(index: number, gen: number): Entity {
  return (((gen & GEN_MASK) << INDEX_BITS) | (index & INDEX_MASK));
}

/** Identity cast kept for API symmetry with packed handles. */
export function asSlotIndex(index: number): SlotIndex {
  return index;
}

/**
 * Allocate a typed array for packed entity handles.
 * Packed handles always require Uint32 storage.
 */
export function createEntityArray(_capacity: number, length: number = _capacity): Uint32Array {
  return new Uint32Array(length);
}

/**
 * Allocate a typed array for raw slot indices sized to world capacity.
 */
export function createSlotArray(capacity: number, length: number = capacity): EntityArray {
  if (capacity <= 0x100) return new Uint8Array(length);
  if (capacity <= 0x1_0000) return new Uint16Array(length);
  return new Uint32Array(length);
}

export class ReusableEntityIterator implements IterableIterator<Entity> {
  count: number;
  cursor: number;
  indices: Uint32Array;
  result: IteratorResult<Entity>;

  constructor(indices: Uint32Array) {
    this.indices = indices;
    this.count = 0;
    this.cursor = 0;
    this.result = { value: 0 as Entity, done: false };
  }

  reset(count: number): this {
    this.count = count;
    this.cursor = 0;
    return this;
  }

  next(): IteratorResult<Entity> {
    if (this.cursor < this.count) {
      this.result.value = this.indices[this.cursor++]! as Entity;
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

/** @internal Generation bit mask for entity packing. */
export const ENTITY_GEN_MASK = GEN_MASK;
/** @internal Index bit mask for entity packing. */
export const ENTITY_INDEX_MASK = INDEX_MASK;
