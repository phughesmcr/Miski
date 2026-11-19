import type { Archetype } from "@/archetype/archetype.ts";
import type { TransitionWindow } from "@/archetype/transition-window.ts";
import type { Entity } from "@/entity/entity.ts";
import type { QueryInstance } from "@/types/query.ts";
import type { Query } from "./query.ts";

/** World state the archetype query iterators read. */
export type ArchetypeQueryIteratorHost = {
  /** Register the query if needed and bring its archetype list up to date. */
  instanceWithMembership(query: Query): QueryInstance;
  /** The world's current refresh window. */
  readonly transitionWindow: TransitionWindow;
  /** Archetype currently inhabited by a raw storage slot (`undefined` when the slot is free). */
  archetypeAtSlot(slot: number): Archetype | undefined;
  /** Archetype a live entity handle inhabits (`undefined` when the handle is stale). */
  getEntityArchetype(entity: Entity): Archetype | undefined;
  /** Pack a live storage slot into its current entity handle. */
  packSlot(slot: number): Entity;
};

/** Where an iterator goes back to when it finishes. */
type IteratorReleaser = { release(iterator: PooledQueryIterator): void };

/**
 * Base for the pooled, allocation-free replacements of the archetype query generators.
 *
 * Each call hands out an idle iterator (or makes one when every pooled iterator is in use, e.g. nested
 * iteration), so concurrent iterations stay independent. An iterator returns itself to its pool when it is
 * exhausted or closed early (`break` calls {@link return}); one abandoned mid-way is simply garbage collected.
 * Like the generators they replace, iterators resolve the query on the first {@link next} and read live world
 * state on every step. Do not keep calling `next()` on an iterator after it reported `done`: by then it may be
 * serving another caller.
 */
abstract class PooledQueryIterator implements IterableIterator<Entity> {
  protected readonly host: ArchetypeQueryIteratorHost;
  readonly #pool: IteratorReleaser;
  #query: Query | undefined;
  #inUse: boolean = false;
  protected instance: QueryInstance | undefined;
  protected readonly result: IteratorResult<Entity>;

  constructor(host: ArchetypeQueryIteratorHost, pool: IteratorReleaser) {
    this.host = host;
    this.#pool = pool;
    this.result = { value: undefined as unknown as Entity, done: false };
  }

  /** Prepare for a new iteration of `query`. */
  open(query: Query): this {
    this.#query = query;
    this.#inUse = true;
    this.instance = undefined;
    return this;
  }

  /** Reset per-iteration cursors once the query instance is resolved. */
  protected abstract start(instance: QueryInstance): void;

  /** Write the next entity into {@link result}; `false` when exhausted. */
  protected abstract advance(instance: QueryInstance): boolean;

  next(): IteratorResult<Entity> {
    const result = this.result;
    if (!this.#inUse) return this.#finish();
    let instance = this.instance;
    if (instance === undefined) {
      try {
        instance = this.host.instanceWithMembership(this.#query!);
      } catch (error) {
        this.#finish();
        throw error;
      }
      this.instance = instance;
      this.start(instance);
    }
    if (this.advance(instance)) {
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
    const result = this.result;
    result.value = undefined as unknown as Entity;
    result.done = true;
    if (this.#inUse) {
      this.#inUse = false;
      this.#query = undefined;
      this.instance = undefined;
      this.#pool.release(this);
    }
    return result;
  }
}

/** Entities that match the query now but did not when the refresh window began, in first-touch order. */
class ArchetypeEnteredIterator extends PooledQueryIterator {
  #index = 0;

  protected start(): void {
    this.#index = 0;
  }

  protected advance(instance: QueryInstance): boolean {
    const host = this.host;
    const window = host.transitionWindow;
    while (this.#index < window.touchedCount) {
      const slot = window.touchedSlot(this.#index++);
      const current = host.archetypeAtSlot(slot);
      if (current === undefined || !current.isCandidate(instance)) continue;
      const entity = host.packSlot(slot);
      if (window.originOf(entity)?.isCandidate(instance)) continue;
      this.result.value = entity;
      return true;
    }
    return false;
  }
}

/** Entities that matched the query when the refresh window began but do not now, in first-touch order. */
class ArchetypeExitedIterator extends PooledQueryIterator {
  #index = 0;

  protected start(): void {
    this.#index = 0;
  }

  protected advance(instance: QueryInstance): boolean {
    const host = this.host;
    const window = host.transitionWindow;
    while (this.#index < window.touchedCount) {
      const slot = window.touchedSlot(this.#index++);
      const origin = window.originAt(slot);
      if (origin === undefined || !origin.isCandidate(instance)) continue;
      const entity = window.handleAt(slot);
      if (host.getEntityArchetype(entity)?.isCandidate(instance)) continue;
      this.result.value = entity;
      return true;
    }
    return false;
  }
}

type IteratorConstructor<T extends PooledQueryIterator> = new (
  host: ArchetypeQueryIteratorHost,
  pool: IteratorReleaser,
) => T;

/** Stack of idle iterators of one kind. */
class QueryIteratorPool<T extends PooledQueryIterator> {
  readonly #host: ArchetypeQueryIteratorHost;
  readonly #create: IteratorConstructor<T>;
  readonly #idle: T[] = [];
  #idleCount = 0;

  constructor(host: ArchetypeQueryIteratorHost, create: IteratorConstructor<T>) {
    this.#host = host;
    this.#create = create;
  }

  acquire(query: Query): IterableIterator<Entity> {
    const iterator = this.#idleCount > 0 ? this.#idle[--this.#idleCount]! : new this.#create(this.#host, this);
    return iterator.open(query);
  }

  release(iterator: PooledQueryIterator): void {
    this.#idle[this.#idleCount++] = iterator as T;
  }
}

/** Pooled iterators behind `world.entities.queryEntered` / `queryExited`. */
export class ArchetypeQueryIterators {
  readonly #entered: QueryIteratorPool<ArchetypeEnteredIterator>;
  readonly #exited: QueryIteratorPool<ArchetypeExitedIterator>;

  constructor(host: ArchetypeQueryIteratorHost) {
    this.#entered = new QueryIteratorPool(host, ArchetypeEnteredIterator);
    this.#exited = new QueryIteratorPool(host, ArchetypeExitedIterator);
  }

  /** Entities that match the query now but did not match it when the refresh window began. */
  entered(query: Query): IterableIterator<Entity> {
    return this.#entered.acquire(query);
  }

  /** Entities that matched the query when the refresh window began but do not match it now. */
  exited(query: Query): IterableIterator<Entity> {
    return this.#exited.acquire(query);
  }
}
