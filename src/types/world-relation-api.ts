import type { BorrowedEntityIterator, BorrowedEntityList, Entity } from "@/entity/entity.ts";
import type { Query } from "@/query/query.ts";
import type { Relation } from "@/relation/relation.ts";
import type { ComponentData, ComponentPartitions, SchemaOrNull } from "@/types/partitions.ts";

/** Any relation, whatever its pair data. */
export type AnyRelation = Relation<SchemaOrNull>;

/** Partial numeric pair data accepted by relation writes. */
export type RelationDataInput<TSchema extends SchemaOrNull> = TSchema extends null ? Record<never, number> :
  Partial<Record<keyof TSchema, number>>;

/**
 * A borrowed list of related entities. Valid until the next call that fills the same list.
 * `rows[i]` is the pair row of entry `i`, which indexes {@link RelationInstance.partitions}.
 */
export type BorrowedRelationList = BorrowedEntityList & {
  /** Pair rows parallel to `entities`. Read only entries `0 <= i < count`. */
  readonly rows: { readonly [index: number]: number };
};

/** A borrowed parents-first traversal. `depths[i]` is the distance of entry `i` from its root. */
export type BorrowedHierarchyList = BorrowedEntityList & {
  /** Depths parallel to `entities`; roots are depth 0. Read only entries `0 <= i < count`. */
  readonly depths: { readonly [index: number]: number };
};

/** World-local storage view of one relation. */
export type RelationInstance<TSchema extends SchemaOrNull = SchemaOrNull> = {
  /** The relation definition. */
  readonly type: Relation<TSchema>;
  /**
   * Pair data columns indexed by pair row (`null` for relations without data).
   * Columns of multi-target relations are replaced when the pair pool grows, so re-read them after adding pairs.
   */
  readonly partitions: ComponentPartitions<TSchema>;
  /** @returns the pair row of `source -> target`, or `-1` when there is no such pair */
  rowOf(source: Entity, target: Entity): number;
};

/** Relation API of a world: pairs, reverse lookups, pair data and hierarchy traversal. */
export type WorldRelationAPI = {
  /**
   * Relate `source` to `target`. Exclusive relations replace an existing target (data starts at zero unless given);
   * adding an existing pair keeps its position and merges `data`.
   * @throws {EntityNotFoundError} - If either entity is not active
   * @throws {NotRegisteredError} - If the relation is not registered
   * @throws {RelationCycleError} - If an acyclic relation would form a cycle
   * @throws {ComponentDataError} - If `data` is invalid
   */
  add<TSchema extends SchemaOrNull>(
    relation: Relation<TSchema>,
    source: Entity,
    target: Entity,
    data?: RelationDataInput<TSchema>,
  ): void;
  /**
   * Remove `source -> target`. Use {@link WorldRelationAPI.removeAll} to remove every target of `source`.
   * @returns `true` if the pair existed and was removed
   */
  remove(relation: AnyRelation, source: Entity, target: Entity): boolean;
  /** Remove every target of `source`. @returns the number of pairs removed */
  removeAll(relation: AnyRelation, source: Entity): number;
  /** @returns `true` if `source` relates to `target` */
  has(relation: AnyRelation, source: Entity, target: Entity): boolean;
  /** @returns `true` if `source` is active and relates to at least one target */
  hasAny(relation: AnyRelation, source: Entity): boolean;
  /** @returns the first target of `source` (the parent, for an exclusive relation), or `undefined` */
  getTarget(relation: AnyRelation, source: Entity): Entity | undefined;
  /** Targets of `source` in the order they were added. Borrowed. */
  getTargets(relation: AnyRelation, source: Entity): BorrowedRelationList;
  /** Sources that relate to `target` (the children, for a hierarchy) in the order they were added. Borrowed. */
  getSources(relation: AnyRelation, target: Entity): BorrowedRelationList;
  /** Every entity that is the target of at least one pair, in first-targeted order. Borrowed. */
  getAllTargets(relation: AnyRelation): BorrowedRelationList;
  /** Sources of `target` that match `query`, in source order. Borrowed. */
  queryList(relation: AnyRelation, target: Entity, query: Query): BorrowedRelationList;
  /** @returns a copy of the pair's data, or `undefined` when there is no such pair */
  getData<TSchema extends SchemaOrNull>(
    relation: Relation<TSchema>,
    source: Entity,
    target: Entity,
  ): ComponentData<TSchema> | undefined;
  /** Copy the pair's data into `out`. @returns `false` when there is no such pair */
  readDataInto<TSchema extends SchemaOrNull>(
    relation: Relation<TSchema>,
    source: Entity,
    target: Entity,
    out: Partial<ComponentData<TSchema>>,
  ): boolean;
  /**
   * Write some or all of a pair's data and mark the source changed.
   * @throws {ComponentOwnershipError} - If there is no such pair
   * @throws {ComponentDataError} - If `data` is invalid
   */
  setData<TSchema extends SchemaOrNull>(
    relation: Relation<TSchema>,
    source: Entity,
    target: Entity,
    data: RelationDataInput<TSchema>,
  ): void;
  /**
   * Sources whose pairs or pair data changed since the last refresh and that still have a target.
   * Retargeting an exclusive relation is reported here, not as an archetype entry or exit.
   */
  getChanged(relation: AnyRelation): BorrowedEntityIterator;
  /**
   * Parents-first (breadth-first) traversal. With `root`, walks the sources below `root` (depth 0 is `root`).
   * Without it, walks every tree whose root is a target that has no target itself, in first-targeted order.
   * Borrowed and cached until the relation's pairs change.
   */
  traverse(relation: AnyRelation, root?: Entity): BorrowedHierarchyList;
  /**
   * World-local storage view (data columns and pair rows). The same view is returned on every call.
   * @returns the view, or `undefined` if the relation is not registered in this world
   */
  getInstance<TSchema extends SchemaOrNull>(relation: Relation<TSchema>): RelationInstance<TSchema> | undefined;
  /**
   * World-local storage view (data columns and pair rows). The same view is returned on every call.
   * @throws {NotRegisteredError} - If the relation is not registered in this world
   */
  getInstanceOrThrow<TSchema extends SchemaOrNull>(relation: Relation<TSchema>): RelationInstance<TSchema>;
};
