import { BooleanArray } from "@phughesmcr/booleanarray";

import type { ArchetypeClock } from "@/archetype/archetype.ts";
import { ID_KEY } from "@/constants.ts";
import { componentDisplayName, formatComponentNotRegistered, NotRegisteredError } from "@/errors.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { Entity } from "@/entity/entity.ts";
import type { QueryInstance, QueryInstanceList } from "@/types/query.ts";
import type { ComponentInstanceGetter, QueryManagerDependencies } from "@/types/world-api.ts";
import { EntityIteratorPool } from "@/entity/pooled-entity-iterator.ts";
import { QueryEntityResult } from "./query-pool.ts";
import type { NormalizedQueryComponentEntry, Query } from "./query.ts";

type QueryComponent = Parameters<ComponentInstanceGetter>[0][number];
type RegisteredComponentInstance = DynamicComponentInstance;

export type { QueryInstanceList };

function getRegisteredInstances(
  getInstances: ComponentInstanceGetter,
  components: ReadonlyArray<QueryComponent>,
): RegisteredComponentInstance[] {
  const instances = getInstances(components);
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    if (!instance) {
      const component = components[i];
      throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component ?? "unknown")));
    }
  }
  return instances as RegisteredComponentInstance[];
}

function addComponentsToLookup(
  lookup: Record<string, RegisteredComponentInstance>,
  entries: readonly NormalizedQueryComponentEntry[],
  instances: readonly RegisteredComponentInstance[],
): void {
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i]!;
    lookup[entries[i]!.key] = instance;
  }
}

function createBindingID(
  entries: readonly NormalizedQueryComponentEntry[],
  instances: readonly RegisteredComponentInstance[],
): string {
  let id = "";
  for (let i = 0; i < instances.length; i++) {
    const key = entries[i]!.key;
    id += `${key.length}:${key}=${instances[i]!.id};`;
  }
  return id;
}

/**
 * @internal
 * Creates a runtime instance of a Query for efficient entity matching
 * @param getInstances - The function to get instances for an array of components
 * @param size - The size of the query
 * @param query - The Query definition specifying component requirements
 * @returns A QueryInstance.
 */
function createQueryInstance(getInstances: ComponentInstanceGetter, size: number, query: Query): QueryInstance {
  // Create AND bit array - marks required components
  const andInstances = getRegisteredInstances(getInstances, query.allEntries.map((entry) => entry.component));
  const and = new BooleanArray(size).setFromObjects(ID_KEY, andInstances, true);

  // Create OR bit array - when present, at least one component must match
  const orInstances = getRegisteredInstances(getInstances, query.anyEntries.map((entry) => entry.component));
  const or = new BooleanArray(size).setFromObjects(ID_KEY, orInstances, true);

  // Create NOT bit array - marks forbidden components
  const notInstances = getRegisteredInstances(getInstances, query.noneEntries.map((entry) => entry.component));
  const not = new BooleanArray(size).setFromObjects(ID_KEY, notInstances, true);

  // Create include bit array - marks non-filtering components exposed to callbacks
  const includeInstances = getRegisteredInstances(getInstances, query.includeEntries.map((entry) => entry.component));
  const include = new BooleanArray(size).setFromObjects(ID_KEY, includeInstances, true);

  // Build lookup table for quick component access
  const components: Record<string, RegisteredComponentInstance> = Object.create(null);
  addComponentsToLookup(components, query.allEntries, andInstances);
  addComponentsToLookup(components, query.anyEntries, orInstances);
  addComponentsToLookup(components, query.includeEntries, includeInstances);
  Object.freeze(components);

  const bindings = `${createBindingID(query.allEntries, andInstances)}|${
    createBindingID(query.anyEntries, orInstances)
  }|${createBindingID(query.includeEntries, includeInstances)}`;
  const id = `${and.toString()}:${or.toString()}:${not.toString()}:${include.toString()}:${bindings}`;

  return {
    and,
    or,
    not,
    include,
    archetypes: [],
    archetypeCount: 0,
    components,
    resultStamp: -1,
    resultEpoch: -1,
    listStamp: 0,
    id,
  };
}

/**
 * Whether a query's retained result still lists exactly the entities of its archetypes, in order.
 * The result is current when neither the archetype list nor any listed archetype changed after it was filled.
 */
function isResultCurrent(instance: QueryInstance, clock: ArchetypeClock): boolean {
  const filled = instance.resultStamp;
  if (filled === clock.tick) return true;
  if (instance.listStamp > filled) return false;
  const archetypes = instance.archetypes;
  const archetypeCount = instance.archetypeCount;
  for (let i = 0; i < archetypeCount; i++) {
    if (archetypes[i]!.stamp > filled) return false;
  }
  return true;
}

/** The QueryManager is responsible for creating, registering, and destroying queries. */
export class QueryManager {
  /** Component registry accessors supplied by the owning World. */
  #dependencies: QueryManagerDependencies;

  /** Callback for refreshing query-to-archetype membership. */
  #ensureQueryMembership: (queries: QueryInstanceList) => void;

  /** Callback for registering one query against existing archetypes. */
  #registerQueryMembership: (query: QueryInstance) => void;

  /** Dense registered query instances (avoids Map.values() on the hot path). */
  readonly #queries: QueryInstance[] = [];

  /** Reusable dense-list view over {@link #queries} - never reallocated. */
  readonly #queryList: { queries: QueryInstance[]; count: number };

  /** Per-call iterators handed out by {@link entities}; they borrow each query's retained result buffer. */
  readonly #iterators = new EntityIteratorPool();

  /** Capacity of each query's lazily allocated entity result. */
  readonly #capacity: number;

  /** The world's structural change clock, which stamps retained results. */
  readonly #clock: ArchetypeClock;

  /**
   * Whole-cache invalidation epoch. Ordinary structural changes are tracked per archetype (see
   * {@link isResultCurrent}); this is only bumped by {@link invalidate}, e.g. after a rollback restore.
   */
  #epoch = 0;

  /** Map of query IDs to their instances */
  readonly instancesByID: Map<string, QueryInstance>;

  /** Map of Query objects straight to their instances (one lookup on the hot path) */
  readonly #instancesByQuery: WeakMap<Query, QueryInstance>;

  /**
   * Create a new QueryManager
   * @param dependencies - Component registry accessors and lifecycle hooks
   * @param capacity - The world's entity capacity
   * @param ensureQueryMembership - Refreshes query-to-archetype membership
   * @param registerQueryMembership - Registers one query against existing archetypes
   * @param clock - The world's structural change clock
   */
  constructor(
    dependencies: QueryManagerDependencies,
    capacity: number,
    ensureQueryMembership: (queries: QueryInstanceList) => void,
    registerQueryMembership: (query: QueryInstance) => void,
    clock: ArchetypeClock,
  ) {
    this.#clock = clock;
    this.#dependencies = dependencies;
    this.#ensureQueryMembership = ensureQueryMembership;
    this.#registerQueryMembership = registerQueryMembership;
    this.#queryList = { queries: this.#queries, count: 0 };
    this.#capacity = capacity;
    this.instancesByID = new Map();
    this.#instancesByQuery = new WeakMap();
  }

  /** Dense registered queries for archetype membership rebuilds. */
  get registeredQueries(): QueryInstanceList {
    return this.#queryList;
  }

  /** Get components for a query */
  components(query: Query): Record<string, DynamicComponentInstance> {
    const instance = this.register(query);
    return instance.components;
  }

  /**
   * Get entities for a query: a pooled per-call iterator over the query's retained result as it stands now, so
   * nested loops over the same query each get their own cursor.
   */
  entities(query: Query): IterableIterator<Entity> {
    const list = this.entityList(query);
    return this.#iterators.acquire().open(list.entityBuffer, list.count);
  }

  /** Get entities for a query as a dense reusable list */
  entityList(query: Query): QueryEntityResult {
    const instance = this.register(query);
    this.ensureQueryMembership();

    const retained = instance.result;
    if (retained !== undefined && instance.resultEpoch === this.#epoch && isResultCurrent(instance, this.#clock)) {
      return retained;
    }

    const result = retained ?? (instance.result = new QueryEntityResult(this.#capacity));
    result.clear();
    const archetypes = instance.archetypes;
    const archetypeCount = instance.archetypeCount;
    let total = 0;
    for (let i = 0; i < archetypeCount; i++) total += archetypes[i]!.getPopulationCount();
    result.reserve(total);
    for (let i = 0; i < archetypeCount; i++) {
      const archetype = archetypes[i]!;
      result.appendDense(archetype.slotList, archetype.handleList, archetype.getPopulationCount());
    }
    instance.resultStamp = this.#clock.tick;
    instance.resultEpoch = this.#epoch;
    return result;
  }

  /** Register a query */
  register(query: Query): QueryInstance {
    const known = this.#instancesByQuery.get(query);
    if (known !== undefined) return known;

    // Create new instance
    const instance: QueryInstance = createQueryInstance(
      this.#dependencies.getInstances,
      this.#dependencies.componentCount,
      query,
    );
    const queryId = instance.id;
    const existing = this.instancesByID.get(queryId);
    if (existing) {
      this.#instancesByQuery.set(query, existing);
      return existing;
    }

    // Store mappings
    this.#instancesByQuery.set(query, instance);
    this.instancesByID.set(queryId, instance);
    this.#queries[this.#queryList.count++] = instance;

    // Refresh archetypes after query registration to update mappings
    if (this.#dependencies.isInitialized()) {
      this.#registerQueryMembership(instance);
    }

    return instance;
  }

  /** Register a query and return its instance after membership is current. */
  instanceWithMembership(query: Query): QueryInstance {
    const instance = this.register(query);
    this.ensureQueryMembership();
    return instance;
  }

  /** Ensures query-to-archetype membership is current before entity queries. */
  ensureQueryMembership(): void {
    this.#ensureQueryMembership(this.registeredQueries);
  }

  /**
   * Invalidate every retained entity result, whatever the archetype stamps say.
   * Ordinary entity/component transitions do not need this; rollback restores do.
   */
  invalidate(): void {
    this.#epoch++;
  }
}
