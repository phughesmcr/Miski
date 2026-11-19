import type { Entity } from "@/entity/entity.ts";

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
