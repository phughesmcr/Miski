import { Component, isValidComponentArray } from "@/component/component.ts";
import { SpecError } from "@/errors.ts";
import type { ComponentInstances, ComponentMap, DynamicComponent } from "@/types/component.ts";
import type { QuerySpec, TypedQuerySpec, UntypedQueryComponents } from "@/types/query.ts";
import { isObject } from "@/utils.ts";

/** A normalized query component with the callback key authored by the user. */
export type NormalizedQueryComponentEntry = {
  readonly key: string;
  readonly component: DynamicComponent;
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
function isComponentMap(value: unknown): value is ComponentMap {
  if (!isObject(value)) return false;
  for (const component of Object.values(value)) {
    if (!(component instanceof Component)) return false;
  }
  return true;
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
      return clause.map((component) => Object.freeze({ key: component.name, component }));
    }
    return Object.entries(clause).map(([key, component]) => Object.freeze({ key, component }));
  };

  return {
    all: normalizeClause(spec.all),
    any: normalizeClause(spec.any),
    none: normalizeClause(spec.none),
    include: normalizeClause(spec.include),
  };
}

function entriesToComponentMap(entries: readonly NormalizedQueryComponentEntry[]): Record<string, DynamicComponent> {
  const result: Record<string, DynamicComponent> = Object.create(null);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const key = entry.key;
    const existing = result[key];
    if (existing === entry.component) continue;
    if (existing !== undefined) {
      throw new SpecError(`Duplicate query component key "${key}".`);
    }
    result[key] = entry.component;
  }
  return result;
}

function uniqueEntryComponents(entries: readonly NormalizedQueryComponentEntry[]): Readonly<DynamicComponent[]> {
  const result: DynamicComponent[] = [];
  for (let i = 0; i < entries.length; i++) {
    const component = entries[i]!.component;
    if (!result.includes(component)) result.push(component);
  }
  return Object.freeze(result);
}

function hasComponentOverlap(
  left: readonly NormalizedQueryComponentEntry[],
  right: readonly NormalizedQueryComponentEntry[],
): boolean {
  for (let i = 0; i < left.length; i++) {
    const component = left[i]!.component;
    for (let j = 0; j < right.length; j++) {
      if (right[j]!.component === component) return true;
    }
  }
  return false;
}

function hasDuplicateCallbackKeys(entries: NormalizedQueryEntrySpec): boolean {
  const seen = new Set<string>();
  for (const clause of [entries.all, entries.any, entries.include]) {
    for (let i = 0; i < clause.length; i++) {
      const key = clause[i]!.key;
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }
  return false;
}

/**
 * Validate a query spec and normalize it in one pass.
 * @returns The normalized entries, or `undefined` if the spec is invalid
 */
function validateQuerySpec(spec: unknown): NormalizedQueryEntrySpec | undefined {
  if (isObject(spec) === false) return undefined;
  const { all, any, include, none } = spec as QueryInputSpec;
  if (all == undefined && any == undefined && none == undefined && include == undefined) return undefined;
  if (all !== undefined) {
    if (Array.isArray(all)) {
      if (isValidComponentArray(all) === false) return undefined;
    } else if (isComponentMap(all) === false) {
      return undefined;
    }
  }
  if (any !== undefined) {
    if (Array.isArray(any)) {
      if (isValidComponentArray(any) === false) return undefined;
    } else if (isComponentMap(any) === false) {
      return undefined;
    }
  }
  if (none !== undefined) {
    if (Array.isArray(none)) {
      if (isValidComponentArray(none) === false) return undefined;
    } else if (isComponentMap(none) === false) {
      return undefined;
    }
  }
  if (include !== undefined) {
    if (Array.isArray(include)) {
      if (isValidComponentArray(include) === false) return undefined;
    } else if (isComponentMap(include) === false) {
      return undefined;
    }
  }

  const entries = normalizeQueryEntries(spec as QueryInputSpec);
  if (
    entries.all.length === 0 && entries.any.length === 0 && entries.none.length === 0
  ) return undefined;
  if (hasComponentOverlap(entries.all, entries.any)) return undefined;
  if (hasComponentOverlap(entries.all, entries.none)) return undefined;
  if (hasComponentOverlap(entries.all, entries.include)) return undefined;
  if (hasComponentOverlap(entries.any, entries.none)) return undefined;
  if (hasComponentOverlap(entries.any, entries.include)) return undefined;
  if (hasComponentOverlap(entries.none, entries.include)) return undefined;
  if (hasDuplicateCallbackKeys(entries)) return undefined;
  return entries;
}

/**
 * A Query is a collection of Components that can be used to find Entities.
 *
 * Create queries once, at startup, and reuse them: a query lives as long as the world. The first time a world
 * sees a query it builds an internal instance for it, and that instance stays registered, and is kept current on
 * every refresh, until the world is destroyed; there is no way to unregister it. Creating a query inside a system
 * or a loop repeats that setup work, and every distinct filter adds to the cost of each refresh.
 */
export interface Query<TComponents extends ComponentMap = UntypedQueryComponents> {
  /** Carries the typed component map through to {@link System} inference. */
  readonly $inferComponents: ComponentInstances<TComponents>;

  /** `AND` - Gather entities as long as they have all these components */
  readonly all: Readonly<DynamicComponent[]>;

  /** `OR` - When present, gather entities that have at least one of these components */
  readonly any: Readonly<DynamicComponent[]>;

  /** `NOT` - Gather entities as long as they don't have these components */
  readonly none: Readonly<DynamicComponent[]>;

  /** Non-filtering component instances exposed to callbacks */
  readonly include: Readonly<DynamicComponent[]>;

  /** Components whose membership or data changes affect the query revision. */
  readonly dependencyComponents: readonly DynamicComponent[];

  /** `all` entries keyed as authored for component callbacks. */
  readonly allEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /** `any` entries keyed as authored for component callbacks. */
  readonly anyEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /** `none` entries keyed as authored for validation/debugging only. */
  readonly noneEntries: Readonly<NormalizedQueryComponentEntry[]>;

  /** `include` entries keyed as authored for component callbacks. */
  readonly includeEntries: Readonly<NormalizedQueryComponentEntry[]>;
}

/** Query implementation used by the {@link Query} constructor. */
class QueryRuntime<TComponents extends ComponentMap = UntypedQueryComponents> implements Query<TComponents> {
  /** Carries the typed component map through to {@link System} inference. */
  declare readonly $inferComponents: ComponentInstances<TComponents>;

  /**
   * Compose a new Query that matches entities matching every input query (their logical `AND`).
   *
   * `all`, `none` and `include` components are unioned; an `include` entry is dropped when another input
   * lists the same component under the same key in `all` or `any`. A query holds a single `any` group, so
   * at most one input may have a non-empty `any`: it passes through unchanged and stays an `AND`
   * with the other inputs' requirements. Unioning several `any` groups would turn
   * `(A | B) AND (C | D)` into `A | B | C | D`, so that case is rejected instead.
   * Components from an `any` group are exposed to callbacks but are not guaranteed to be present.
   * @param queries - The Queries to compose
   * @returns A new Query object
   * @throws {SpecError} if more than one input has a non-empty `any` group, or the combined spec is invalid
   */
  static compose<const TQueries extends readonly Query<ComponentMap>[]>(
    queries: TQueries,
  ): Query<ComposedQueryComponents<TQueries>> {
    let anyGroups = 0;
    for (let i = 0; i < queries.length; i++) {
      if (queries[i]!.anyEntries.length > 0) anyGroups++;
    }
    if (anyGroups > 1) {
      throw new SpecError(
        "Query.compose accepts at most one input query with a non-empty `any` group; " +
          "merging several would change (A | B) AND (C | D) into A | B | C | D.",
      );
    }
    const allEntries = queries.flatMap((query) => query.allEntries);
    const anyEntries = queries.flatMap((query) => query.anyEntries);
    const noneEntries = queries.flatMap((query) => query.noneEntries);
    // `include` is non-filtering, so an input's include entry adds nothing when another input already
    // requires or offers the same component under the same key; keep the filtering role instead of rejecting.
    const includeEntries = queries.flatMap((query) => query.includeEntries).filter((entry) =>
      !allEntries.some((other) => other.component === entry.component && other.key === entry.key) &&
      !anyEntries.some((other) => other.component === entry.component && other.key === entry.key)
    );
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

  /** Components whose membership or data changes affect the query revision. */
  readonly dependencyComponents: readonly DynamicComponent[];

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
    const entries = validateQuerySpec(spec);
    if (entries === undefined) {
      throw new SpecError("Query specification object is invalid.");
    }
    this.all = uniqueEntryComponents(entries.all);
    this.any = uniqueEntryComponents(entries.any);
    this.none = uniqueEntryComponents(entries.none);
    this.include = uniqueEntryComponents(entries.include);
    this.dependencyComponents = uniqueEntryComponents([
      ...entries.all,
      ...entries.any,
      ...entries.none,
      ...entries.include,
    ]);
    this.allEntries = Object.freeze(entries.all);
    this.anyEntries = Object.freeze(entries.any);
    this.noneEntries = Object.freeze(entries.none);
    this.includeEntries = Object.freeze(entries.include);
  }
}

/** Extract the typed component map carried by a query. */
export type QueryComponents<TQuery> = TQuery extends Query<infer TComponents extends ComponentMap> ? TComponents :
  never;

/**
 * Component map produced by composing several typed queries.
 * Like any typed query, components from an `any` group are exposed to callbacks without a presence guarantee.
 */
export type ComposedQueryComponents<TQueries extends readonly Query<ComponentMap>[]> =
  QueryComponents<TQueries[number]> extends infer TUnion ?
    (TUnion extends unknown ? (value: TUnion) => void : never) extends (value: infer TIntersection) => void ?
      TIntersection extends ComponentMap ? TIntersection : UntypedQueryComponents :
    UntypedQueryComponents :
    UntypedQueryComponents;

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
  /**
   * Compose queries into one that matches entities matching every input (logical `AND`).
   * At most one input may have a non-empty `any` group; otherwise a {@link SpecError} is thrown.
   */
  compose<const TQueries extends readonly Query<ComponentMap>[]>(
    queries: TQueries,
  ): Query<ComposedQueryComponents<TQueries>>;
}

/** A Query is a collection of Components that can be used to find Entities. Create queries once; they live as long as the world. */
export const Query: QueryConstructor = QueryRuntime;
