import type { Entity } from "@/entity/entity.ts";
import type { Query } from "./query.ts";

/** An iterator a {@link QueryIteratorPool} can reopen for a new query. */
export type PoolableQueryIterator = {
  /** Prepare for a new iteration of `query`. */
  open(query: Query): IterableIterator<Entity>;
};

/** Where a pooled iterator goes back to when it finishes. */
export type IteratorReleaser<T> = { release(iterator: T): void };

/** Builds a new pooled iterator bound to its host and pool. */
export type IteratorConstructor<Host, T extends PoolableQueryIterator> = new (
  host: Host,
  pool: IteratorReleaser<T>,
) => T;

/**
 * Stack of idle iterators of one kind.
 *
 * {@link acquire} hands out an idle iterator, or makes one when every pooled iterator is in use (e.g. nested
 * iteration), so concurrent iterations stay independent. Iterators call {@link release} when they finish.
 */
export class QueryIteratorPool<Host, T extends PoolableQueryIterator> {
  readonly #host: Host;
  readonly #create: IteratorConstructor<Host, T>;
  readonly #idle: T[] = [];
  #idleCount = 0;

  /**
   * @param host - World state passed to every iterator the pool creates
   * @param create - The iterator class
   */
  constructor(host: Host, create: IteratorConstructor<Host, T>) {
    this.#host = host;
    this.#create = create;
  }

  /** Start iterating `query` with an idle (or new) iterator. */
  acquire(query: Query): IterableIterator<Entity> {
    const iterator = this.#idleCount > 0 ? this.#idle[--this.#idleCount]! : new this.#create(this.#host, this);
    return iterator.open(query);
  }

  /** Return a finished iterator to the idle stack. */
  release(iterator: T): void {
    this.#idle[this.#idleCount++] = iterator;
  }
}
