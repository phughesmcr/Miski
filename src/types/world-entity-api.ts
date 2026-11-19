import type {
  BorrowedEntityIterator,
  BorrowedEntityList,
  Entity,
  QueryEntityList,
  SlotIndex,
} from "@/entity/entity.ts";
import type { Prefab } from "@/prefab/prefab.ts";
import type { Query } from "@/query/query.ts";
import type { ComponentBundle, ComponentBundleEntryInput } from "@/types/component-bundle.ts";

/** The public Entity management API */
export type WorldEntityAPI = {
  /** The capacity of the EntityManager */
  readonly capacity: number;
  /**
   * Create an entity, optionally with a component bundle attached atomically. The bundle is validated before
   * capacity is checked, and the entity goes straight into its final archetype.
   * @returns the new entity, or `undefined` if the world is at capacity. Handle `0` is valid, so compare with
   * `=== undefined`, not truthiness.
   * @throws {NotRegisteredError | TypeError | RangeError | ComponentDataError} - If the bundle is invalid
   */
  create<const TBundle extends readonly ComponentBundleEntryInput[] = readonly []>(
    bundle?: TBundle & ComponentBundle<TBundle>,
  ): Entity | undefined;
  /**
   * Create an entity, optionally with a component bundle attached atomically (see {@link WorldEntityAPI.create}).
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   */
  createOrThrow<const TBundle extends readonly ComponentBundleEntryInput[] = readonly []>(
    bundle?: TBundle & ComponentBundle<TBundle>,
  ): Entity;
  /** Destroy an entity */
  destroy(entity: Entity): void;
  /**
   * Get active handles within raw slot bounds: inclusive start (default 0), exclusive end (default capacity).
   * Returns a pooled per-call iterator over a snapshot taken now, so nested loops are independent.
   */
  getActive(startSlot?: SlotIndex, endSlot?: SlotIndex): BorrowedEntityIterator;
  /** Get a stable snapshot within the same raw slot bounds as {@link getActive}. */
  getActiveSnapshot(startSlot?: SlotIndex, endSlot?: SlotIndex): Entity[];
  /** Get the number of active entities */
  getActiveCount(): number;
  /** Get the number of available entities */
  getAvailableCount(): number;
  /** Check if an entity is active (its slot is live and its generation matches) */
  isActive(entity: Entity): boolean;
  /** Check if an entity is active and has no components */
  isEmpty(entity: Entity): boolean;
  /**
   * Query for entities. Returns a pooled per-call iterator over the query's current result, so nested loops over
   * the same query are independent and destroying or moving the current entity skips nothing.
   */
  query(query: Query): BorrowedEntityIterator;
  /** Query for entities as a dense reusable list for index-based hot loops */
  queryList(query: Query): BorrowedEntityList;
  /**
   * Entities that match the query now but did not when the refresh window began (since the last
   * `world.refresh()`), in first-touch order. Returns a pooled iterator that reads live world state on each step.
   */
  queryEntered(query: Query): IterableIterator<Entity>;
  /**
   * Entities that matched the query when the refresh window began but do not now, in first-touch order.
   * Reports the window-start handle, which may since have been destroyed. Returns a pooled live iterator.
   */
  queryExited(query: Query): IterableIterator<Entity>;
  /** Query for entities as a stable allocating array snapshot (`toArray(queryList(query))`) */
  querySnapshot(query: Query): Entity[];
  /** Copy a borrowed entity list (such as a {@link queryList} or `instantiateMany` result) into a stable array */
  toArray(list: QueryEntityList): Entity[];
  /**
   * Create an entity from a prefab, or return `undefined` if the world is at capacity.
   * Every check finishes before allocation, so a rejected call creates nothing.
   * Override tuples merge field by field over the prefab defaults and may add components the prefab lacks.
   */
  instantiate<const TBundle extends readonly ComponentBundleEntryInput[] = readonly []>(
    prefab: Prefab,
    overrides?: TBundle & ComponentBundle<TBundle>,
  ): Entity | undefined;
  /**
   * Create an entity from a prefab
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   */
  instantiateOrThrow<const TBundle extends readonly ComponentBundleEntryInput[] = readonly []>(
    prefab: Prefab,
    overrides?: TBundle & ComponentBundle<TBundle>,
  ): Entity;
  /**
   * Create `count` entities from a prefab, all or nothing, with the same overrides. Object override values are
   * shared by every new entity; prefab object defaults are cloned per entity.
   * Returns a borrowed list of the new entities in allocation order (valid until the next instantiate or world
   * mutation), or `undefined` if they do not all fit.
   */
  instantiateMany<const TBundle extends readonly ComponentBundleEntryInput[] = readonly []>(
    prefab: Prefab,
    count: number,
    overrides?: TBundle & ComponentBundle<TBundle>,
  ): BorrowedEntityList | undefined;
  /**
   * Create `count` entities from a prefab, all or nothing
   * @throws {CapacityError} - If fewer than `count` entity slots are free
   */
  instantiateManyOrThrow<const TBundle extends readonly ComponentBundleEntryInput[] = readonly []>(
    prefab: Prefab,
    count: number,
    overrides?: TBundle & ComponentBundle<TBundle>,
  ): BorrowedEntityList;
};
