import type { Entity, EntityArray, PackSlot } from "@/entity/entity.ts";

const EMPTY_INDICES = new Uint32Array(0);

/**
 * A per-call cursor over a dense list of packed entity handles, handed out by an {@link EntityIteratorPool}.
 *
 * Every call that returns one gets its own cursor, so nested loops over the same list stay independent. The
 * iterator returns itself to its pool when it is exhausted or closed early (`break` calls {@link return}); one
 * abandoned mid-way is simply garbage collected. Do not keep calling {@link next} after it reported `done`: by
 * then it may be serving another caller.
 */
export class PooledEntityIterator implements IterableIterator<Entity> {
  /** Packed entity handles; only entries before {@link count} are read. */
  indices: Uint32Array = EMPTY_INDICES;
  /** Number of valid leading entries in {@link indices}. */
  count: number = 0;
  #cursor: number = 0;
  #inUse: boolean = false;
  readonly #pool: EntityIteratorPool;
  readonly #result: IteratorResult<Entity> = { value: undefined as unknown as Entity, done: false };

  constructor(pool: EntityIteratorPool) {
    this.#pool = pool;
  }

  /** Start a new pass over the first `count` handles of `indices`. */
  open(indices: Uint32Array, count: number): this {
    this.indices = indices;
    this.count = count;
    this.#cursor = 0;
    this.#inUse = true;
    return this;
  }

  next(): IteratorResult<Entity> {
    const result = this.#result;
    if (this.#cursor < this.count) {
      result.value = this.indices[this.#cursor++]! as Entity;
      result.done = false;
      return result;
    }
    return this.#finish();
  }

  return(): IteratorResult<Entity> {
    return this.#finish();
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }

  #finish(): IteratorResult<Entity> {
    const result = this.#result;
    result.value = undefined as unknown as Entity;
    result.done = true;
    this.count = 0;
    this.#cursor = 0;
    if (this.#inUse) {
      this.#inUse = false;
      this.#pool.release(this);
    }
    return result;
  }
}

/**
 * Stack of idle {@link PooledEntityIterator}s. Warm passes reuse them; a new one is made only when every pooled
 * iterator is in use (nested loops) or one was abandoned without finishing.
 */
export class EntityIteratorPool {
  readonly #idle: PooledEntityIterator[] = [];
  #idleCount = 0;
  /** Keep each iterator's {@link PooledEntityIterator.indices} across releases (it owns that buffer). */
  readonly #ownsBuffers: boolean;

  /**
   * @param ownsBuffers - `true` when each iterator owns its handle buffer and should keep it for reuse; `false`
   * (default) when iterators borrow someone else's buffer, which is dropped on release
   */
  constructor(ownsBuffers: boolean = false) {
    this.#ownsBuffers = ownsBuffers;
  }

  /** Take an idle iterator, or make one. Call {@link PooledEntityIterator.open} on it before handing it out. */
  acquire(): PooledEntityIterator {
    return this.#idleCount > 0 ? this.#idle[--this.#idleCount]! : new PooledEntityIterator(this);
  }

  /** Return a finished iterator to the pool. */
  release(iterator: PooledEntityIterator): void {
    if (!this.#ownsBuffers) iterator.indices = EMPTY_INDICES;
    this.#idle[this.#idleCount++] = iterator;
  }
}

/** A dense slot list that a {@link PooledSlotPackIterator} reads live, so it follows the list when it is reallocated. */
export type SlotListSource = {
  /** Slots in iteration order; only entries before the iterator's count are read. */
  readonly list: EntityArray;
};

const EMPTY_SLOT_SOURCE: SlotListSource = { list: new Uint8Array(0) };

/**
 * A per-call cursor over a dense slot list, packing each slot into an entity handle as it goes. Handed out by a
 * {@link SlotPackIteratorPool}; the same rules as {@link PooledEntityIterator} apply.
 *
 * It reads `source.list` on every step rather than keeping the array it opened with, so a list that grows (and is
 * reallocated) mid-loop is still read where it now lives. The count is fixed when the pass opens.
 */
export class PooledSlotPackIterator implements IterableIterator<Entity> {
  #source: SlotListSource = EMPTY_SLOT_SOURCE;
  #count: number = 0;
  #cursor: number = 0;
  #inUse: boolean = false;
  readonly #pool: SlotPackIteratorPool;
  readonly #packSlot: PackSlot;
  readonly #result: IteratorResult<Entity> = { value: undefined as unknown as Entity, done: false };

  constructor(pool: SlotPackIteratorPool, packSlot: PackSlot) {
    this.#pool = pool;
    this.#packSlot = packSlot;
  }

  /** Start a new pass over the first `count` slots of `source.list`. */
  open(source: SlotListSource, count: number): this {
    this.#source = source;
    this.#count = count;
    this.#cursor = 0;
    this.#inUse = true;
    return this;
  }

  next(): IteratorResult<Entity> {
    const result = this.#result;
    if (this.#cursor < this.#count) {
      result.value = this.#packSlot(this.#source.list[this.#cursor++]!);
      result.done = false;
      return result;
    }
    return this.#finish();
  }

  return(): IteratorResult<Entity> {
    return this.#finish();
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }

  #finish(): IteratorResult<Entity> {
    const result = this.#result;
    result.value = undefined as unknown as Entity;
    result.done = true;
    this.#count = 0;
    this.#cursor = 0;
    if (this.#inUse) {
      this.#inUse = false;
      this.#source = EMPTY_SLOT_SOURCE;
      this.#pool.release(this);
    }
    return result;
  }
}

/** Stack of idle {@link PooledSlotPackIterator}s that share one slot packer; see {@link EntityIteratorPool}. */
export class SlotPackIteratorPool {
  readonly #idle: PooledSlotPackIterator[] = [];
  #idleCount = 0;
  readonly #packSlot: PackSlot;

  /** @param packSlot - Packs a live slot into an entity handle */
  constructor(packSlot: PackSlot) {
    this.#packSlot = packSlot;
  }

  /** Take an idle iterator, or make one, and open it over the first `count` slots of `source.list`. */
  open(source: SlotListSource, count: number): PooledSlotPackIterator {
    const iterator = this.#idleCount > 0 ?
      this.#idle[--this.#idleCount]! :
      new PooledSlotPackIterator(this, this.#packSlot);
    return iterator.open(source, count);
  }

  /** Return a finished iterator to the pool. */
  release(iterator: PooledSlotPackIterator): void {
    this.#idle[this.#idleCount++] = iterator;
  }
}
