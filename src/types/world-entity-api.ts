import type { BorrowedEntityIterator, BorrowedEntityList, Entity } from "@/entity/entity.ts";
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
  /** Get an iterable of all active entities */
  getActive(startEntity?: Entity, endEntity?: Entity): BorrowedEntityIterator;
  /** Get a stable snapshot of all active entities */
  getActiveSnapshot(startEntity?: Entity, endEntity?: Entity): Entity[];
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
};
