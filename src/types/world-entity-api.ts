import type { BorrowedEntityIterator, BorrowedEntityList, Entity, SlotIndex } from "@/entity/entity.ts";
import type { Prefab } from "@/prefab/prefab.ts";
import type { Query } from "@/query/query.ts";
import type { ComponentBundle, ComponentBundleEntryInput } from "@/types/component-bundle.ts";

/** The public Entity management API */
export type WorldEntityAPI = {
  /** The capacity of the EntityManager */
  readonly capacity: number;
  /** Create an entity, or return `undefined` if the world is at capacity */
  create(): Entity | undefined;
  /** Create an entity with a preflighted component bundle, or return `undefined` if the world is at capacity */
  createWith<const TBundle extends readonly ComponentBundleEntryInput[]>(
    bundle: TBundle & ComponentBundle<TBundle>,
  ): Entity | undefined;
  /**
   * Create an entity
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   */
  createOrThrow(): Entity;
  /**
   * Create an entity with a preflighted component bundle
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   */
  createWithOrThrow<const TBundle extends readonly ComponentBundleEntryInput[]>(
    bundle: TBundle & ComponentBundle<TBundle>,
  ): Entity;
  /** Destroy an entity */
  destroy(entity: Entity): void;
  /** Get active handles within raw slot bounds: inclusive start (default 0), exclusive end (default capacity). */
  getActive(startSlot?: SlotIndex, endSlot?: SlotIndex): BorrowedEntityIterator;
  /** Get a stable snapshot within the same raw slot bounds as {@link getActive}. */
  getActiveSnapshot(startSlot?: SlotIndex, endSlot?: SlotIndex): Entity[];
  /** Get the number of active entities */
  getActiveCount(): number;
  /** Get the number of available entities */
  getAvailableCount(): number;
  /** Check if an entity is active */
  isActive(entity: Entity): boolean;
  /** Check if an entity is valid */
  isEntity(entity: Entity): boolean;
  /** Query for entities */
  query(query: Query): BorrowedEntityIterator;
  /** Query for entities as a dense reusable list for index-based hot loops */
  queryList(query: Query): BorrowedEntityList;
  /** Query for entities as a stable allocating array snapshot */
  querySnapshot(query: Query): Entity[];
  /** Copy a borrowed entity list into a stable array */
  toArray(list: BorrowedEntityList): Entity[];
  /**
   * Create an entity from a prefab, or return `undefined` if the world is at capacity.
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
   * Create `count` entities from a prefab, all or nothing, with the same overrides.
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
