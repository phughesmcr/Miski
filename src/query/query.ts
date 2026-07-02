/**
 * @module      Query
 * @description A Query is a collection of Components that can be used to find Entities
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { Component, isValidComponentArray } from "@/component/component.ts";
import { SpecError } from "@/errors.ts";
import type { ComponentInstances, ComponentMap, DynamicComponent } from "@/types/component.ts";
import type { QuerySpec, TypedQuerySpec, UntypedQueryComponents } from "@/types/query.ts";
import { isObject } from "@/utils.ts";

/** Normalized query clauses as component arrays. */
export type NormalizedQuerySpec = {
  all: DynamicComponent[];
  any: DynamicComponent[];
  none: DynamicComponent[];
  include: DynamicComponent[];
};

/** A normalized query component with the callback key authored by the user. */
export type NormalizedQueryComponentEntry = {
  key: string;
  component: DynamicComponent;
};

type NormalizedQueryEntrySpec = {
  all: NormalizedQueryComponentEntry[];
  any: NormalizedQueryComponentEntry[];
  none: NormalizedQueryComponentEntry[];
  include: NormalizedQueryComponentEntry[];
};

/** Array- or map-based query specification accepted by {@link Query}. */
export type QueryInputSpec = QuerySpec | TypedQuerySpec<ComponentMap, ComponentMap, ComponentMap, ComponentMap>;

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
  spec: QuerySpec | TypedQuerySpec<ComponentMap, ComponentMap, ComponentMap, ComponentMap>,
): NormalizedQuerySpec {
  const normalizeClause = (clause: DynamicComponent[] | ComponentMap | undefined): DynamicComponent[] => {
    if (clause === undefined) return [];
    return Array.isArray(clause) ? clause : Object.values(clause);
  };

  return {
    all: normalizeClause(spec.all),
    any: normalizeClause(spec.any),
    none: normalizeClause(spec.none),
    include: normalizeClause(spec.include),
  };
}

/** Normalize array- or map-based query specs into keyed component entries. */
function normalizeQueryEntries(
  spec: QuerySpec | TypedQuerySpec<ComponentMap, ComponentMap, ComponentMap, ComponentMap>,
): NormalizedQueryEntrySpec {
  const normalizeClause = (
    clause: DynamicComponent[] | ComponentMap | undefined,
  ): NormalizedQueryComponentEntry[] => {
    if (clause === undefined) return [];
    if (Array.isArray(clause)) {
      return clause.map((component) => ({ key: component.name, component }));
    }
    return Object.entries(clause).map(([key, component]) => ({ key, component }));
  };

  return {
    all: normalizeClause(spec.all),
    any: normalizeClause(spec.any),
    none: normalizeClause(spec.none),
    include: normalizeClause(spec.include),
  };
}

function entriesToComponentMap(entries: readonly NormalizedQueryComponentEntry[]): Record<string, DynamicComponent> {
  const result: Record<string, DynamicComponent> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    let key = entry.key;
    const existing = result[key];
    if (existing === entry.component) continue;
    if (existing !== undefined) {
      key = `${key}:${entry.component.name}:${i}`;
    }
    while (result[key] !== undefined && result[key] !== entry.component) {
      key = `${key}:${i}`;
    }
    result[key] = entry.component;
  }
  return result;
}

/**
 * Type guard for QuerySpec
 * @param spec The specification object to check
 * @returns `true` if the spec is valid, `false` otherwise
 */
export const isValidQuerySpec = (spec: unknown): spec is QueryInputSpec => {
  if (isObject(spec) === false) return false;
  const { all, any, include, none } = spec as QueryInputSpec;
  if (all == undefined && any == undefined && none == undefined && include == undefined) return false;
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
  if (include !== undefined) {
    if (Array.isArray(include)) {
      if (isValidComponentArray(include) === false) return false;
    } else if (isComponentMap(include) === false) {
      return false;
    }
  }

  const normalized = normalizeQuerySpec(spec as QueryInputSpec);
  if (
    normalized.all.length === 0 && normalized.any.length === 0 && normalized.none.length === 0 &&
    include !== undefined
  ) return false;
  if (normalized.all.some((component) => normalized.any.includes(component))) return false;
  if (normalized.all.some((component) => normalized.none.includes(component))) return false;
  if (normalized.all.some((component) => normalized.include.includes(component))) return false;
  if (normalized.any.some((component) => normalized.none.includes(component))) return false;
  if (normalized.any.some((component) => normalized.include.includes(component))) return false;
  if (normalized.none.some((component) => normalized.include.includes(component))) return false;
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
  static compose<const TQueries extends readonly Query<ComponentMap>[]>(
    queries: TQueries,
  ): Query<ComposedQueryComponents<TQueries>> {
    const allEntries = queries.flatMap((query) => query.allEntries);
    const anyEntries = queries.flatMap((query) => query.anyEntries);
    const noneEntries = queries.flatMap((query) => query.noneEntries);
    const includeEntries = queries.flatMap((query) => query.includeEntries);
    const spec: TypedQuerySpec<ComponentMap, ComponentMap, ComponentMap, ComponentMap> = {
      all: entriesToComponentMap(allEntries),
      any: entriesToComponentMap(anyEntries),
      none: entriesToComponentMap(noneEntries),
    };
    if (includeEntries.length > 0) {
      spec.include = entriesToComponentMap(includeEntries);
    }
    return new Query(spec) as Query<ComposedQueryComponents<TQueries>>;
  }

  /** `AND` - Gather entities as long as they have all these components */
  readonly all: Readonly<DynamicComponent[]>;

  /** `OR` - When present, gather entities that have at least one of these components */
  readonly any: Readonly<DynamicComponent[]>;

  /** `NOT` - Gather entities as long as they don't have these components */
  readonly none: Readonly<DynamicComponent[]>;

  /** Non-filtering component instances exposed to callbacks */
  readonly include: Readonly<DynamicComponent[]>;

  /** `all` entries keyed as authored for component callbacks. */
  readonly allEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /** `any` entries keyed as authored for component callbacks. */
  readonly anyEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /** `none` entries keyed as authored for validation/debugging only. */
  readonly noneEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /** `include` entries keyed as authored for component callbacks. */
  readonly includeEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /**
   * Create a new Query
   * @param spec - The Query's specification object
   * @param spec.all - Required components or keyed component map
   * @param spec.any - Optional matching components or keyed component map
   * @param spec.none - Excluded components or keyed component map
   * @param spec.include - Non-filtering components or keyed component map
   * @returns A new Query object
   * @throws {SpecError} if the spec is invalid
   */
  constructor(spec: QueryInputSpec) {
    if (isValidQuerySpec(spec) === false) {
      throw new SpecError("Query specification object is invalid.");
    }
    const normalized = normalizeQuerySpec(spec);
    const entries = normalizeQueryEntries(spec);
    this.all = Object.freeze([...new Set(normalized.all)]);
    this.any = Object.freeze([...new Set(normalized.any)]);
    this.none = Object.freeze([...new Set(normalized.none)]);
    this.include = Object.freeze([...new Set(normalized.include)]);
    this.allEntries = Object.freeze(entries.all);
    this.anyEntries = Object.freeze(entries.any);
    this.noneEntries = Object.freeze(entries.none);
    this.includeEntries = Object.freeze(entries.include);
  }
}

type QueryComponents<TQuery> = TQuery extends Query<infer TComponents extends ComponentMap> ? TComponents : never;

type ComposedQueryComponents<TQueries extends readonly Query<ComponentMap>[]> =
  UnionToIntersection<QueryComponents<TQueries[number]>> extends infer TComponents extends ComponentMap ? TComponents :
    UntypedQueryComponents;

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void ? TIntersection :
  never;

/** Typed query constructor with array- and map-based overloads. */
export interface QueryConstructor {
  /** Create a query from an array-based specification. */
  new (spec: QuerySpec): Query<UntypedQueryComponents>;
  /** Create a typed query from a keyed component-map specification. */
  new <
    const TAll extends ComponentMap = Record<never, never>,
    const TAny extends ComponentMap = Record<never, never>,
    const TNone extends ComponentMap = Record<never, never>,
    const TInclude extends ComponentMap = Record<never, never>,
  >(spec: TypedQuerySpec<TAll, TAny, TNone, TInclude>): Query<TAll & TAny & TInclude>;
  /** Compose multiple queries into one combined query. */
  compose: typeof QueryRuntime.compose;
}

/** A Query is a collection of Components that can be used to find Entities */
export type Query<TComponents extends ComponentMap = UntypedQueryComponents> = QueryRuntime<TComponents>;

/** A Query is a collection of Components that can be used to find Entities */
export const Query: QueryConstructor = QueryRuntime;
