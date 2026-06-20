/**
 * @module      Query
 * @description A Query is a collection of Components that can be used to find Entities
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { BooleanArray } from "@phughesmcr/booleanarray";

import { Component, isValidComponentArray } from "@/component/component.ts";
import { SpecError } from "@/errors.ts";
import type {
  ComponentInstances,
  ComponentMap,
  DynamicComponent,
  QueryInstance,
  QuerySpec,
  TypedQuerySpec,
  UntypedQueryComponents,
} from "@/types.ts";
import { isObject } from "@/utils.ts";

/** Normalized query clauses as component arrays. */
export type NormalizedQuerySpec = {
  all: DynamicComponent[];
  any: DynamicComponent[];
  none: DynamicComponent[];
};

/** Array- or map-based query specification accepted by {@link Query}. */
export type QueryInputSpec = QuerySpec | TypedQuerySpec<ComponentMap, ComponentMap, ComponentMap>;

/** Type guard for keyed component maps used in typed query specs. */
export function isComponentMap(value: unknown): value is ComponentMap {
  if (!isObject(value)) return false;
  for (const component of Object.values(value)) {
    if (!(component instanceof Component)) return false;
  }
  return true;
}

/** Normalize array- or map-based query specs into component arrays. */
export function normalizeQuerySpec(
  spec: QuerySpec | TypedQuerySpec<ComponentMap, ComponentMap, ComponentMap>,
): NormalizedQuerySpec {
  const normalizeClause = (clause: DynamicComponent[] | ComponentMap | undefined): DynamicComponent[] => {
    if (clause === undefined) return [];
    return Array.isArray(clause) ? clause : Object.values(clause);
  };

  return {
    all: normalizeClause(spec.all),
    any: normalizeClause(spec.any),
    none: normalizeClause(spec.none),
  };
}

/**
 * Type guard for QuerySpec
 * @param spec The specification object to check
 * @returns `true` if the spec is valid, `false` otherwise
 */
export const isValidQuerySpec = (spec: unknown): spec is QueryInputSpec => {
  if (isObject(spec) === false) return false;
  const { all, any, none } = spec as QueryInputSpec;
  if (all == undefined && any == undefined && none == undefined) return false;
  if (all !== undefined) {
    if (Array.isArray(all)) {
      if (isValidComponentArray(all) === false) return false;
    } else if (isComponentMap(all) === false) {
      return false;
    }
  }
  if (any !== undefined) {
    if (Array.isArray(any)) {
      if (isValidComponentArray(any) === false) return false;
    } else if (isComponentMap(any) === false) {
      return false;
    }
  }
  if (none !== undefined) {
    if (Array.isArray(none)) {
      if (isValidComponentArray(none) === false) return false;
    } else if (isComponentMap(none) === false) {
      return false;
    }
  }

  const normalized = normalizeQuerySpec(spec as QueryInputSpec);
  if (normalized.all.some((component) => normalized.any.includes(component))) return false;
  if (normalized.all.some((component) => normalized.none.includes(component))) return false;
  if (normalized.any.some((component) => normalized.none.includes(component))) return false;
  return true;
};

/** A Query is a collection of Components that can be used to find Entities */
/** Query implementation used by the {@link Query} constructor. */
export class QueryRuntime<TComponents extends ComponentMap = UntypedQueryComponents> {
  /** Carries the typed component map through to {@link System} inference. */
  declare readonly $inferComponents: ComponentInstances<TComponents>;

  /**
   * Compose a new Query from an array of Queries
   * @param queries - The Queries to compose
   * @returns A new Query object
   */
  static compose(queries: Query[]): Query {
    return new Query({
      all: queries.flatMap((query) => query.all),
      any: queries.flatMap((query) => query.any),
      none: queries.flatMap((query) => query.none),
    });
  }

  /** `AND` - Gather entities as long as they have all these components */
  readonly all: Readonly<DynamicComponent[]>;

  /** `OR` - When present, gather entities that have at least one of these components */
  readonly any: Readonly<DynamicComponent[]>;

  /** `NOT` - Gather entities as long as they don't have these components */
  readonly none: Readonly<DynamicComponent[]>;

  /**
   * Create a new Query
   * @param spec - The Query's specification object
   * @param spec.all - Required components or keyed component map
   * @param spec.any - Optional matching components or keyed component map
   * @param spec.none - Excluded components or keyed component map
   * @returns A new Query object
   * @throws {SpecError} if the spec is invalid
   */
  constructor(spec: QueryInputSpec) {
    if (isValidQuerySpec(spec) === false) {
      throw new SpecError("Query specification object is invalid.");
    }
    const normalized = normalizeQuerySpec(spec);
    this.all = Object.freeze([...new Set(normalized.all)]);
    this.any = Object.freeze([...new Set(normalized.any)]);
    this.none = Object.freeze([...new Set(normalized.none)]);
  }
}

/** Typed query constructor with array- and map-based overloads. */
export interface QueryConstructor {
  /** Create a query from an array-based specification. */
  new (spec: QuerySpec): Query<UntypedQueryComponents>;
  /** Create a typed query from a keyed component-map specification. */
  new <
    const TAll extends ComponentMap,
    const TAny extends ComponentMap,
    const TNone extends ComponentMap,
  >(spec: TypedQuerySpec<TAll, TAny, TNone>): Query<TAll & TAny>;
  /** Compose multiple queries into one combined query. */
  compose: typeof QueryRuntime.compose;
}

/** A Query is a collection of Components that can be used to find Entities */
export type Query<TComponents extends ComponentMap = UntypedQueryComponents> = QueryRuntime<TComponents>;

/** A Query is a collection of Components that can be used to find Entities */
export const Query: QueryConstructor = QueryRuntime;

/**
 * Check if a target bitfield matches query requirements
 * @param target The target bitfield to check
 * @param query The query instance to match against
 * @returns true if the target matches the query requirements
 */
export function isQueryMatch(target: BooleanArray, query: QueryInstance): boolean {
  if (target.isEmpty()) return false;
  if (!target.containsAll(query.and)) return false;
  if (target.intersects(query.not)) return false;
  return query.or.isEmpty() || target.intersects(query.or);
}
