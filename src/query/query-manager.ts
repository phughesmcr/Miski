import { ID_KEY } from "@/constants.ts";
import { BooleanArray } from "@phughesmcr/booleanarray";
import { componentDisplayName, formatComponentNotRegistered, NotRegisteredError } from "@/errors.ts";
import type { Archetype } from "@/archetype/archetype.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { Entity } from "@/entity/entity.ts";
import type { QueryInstance } from "@/types/query.ts";
import type { ComponentInstanceGetter, QueryManagerDependencies } from "@/types/world-api.ts";
import { QueryCache } from "./query-cache.ts";
import { type QueryEntityResult, QueryResultPool } from "./query-pool.ts";
import type { NormalizedQueryComponentEntry, Query } from "./query.ts";

type QueryComponent = Parameters<ComponentInstanceGetter>[0][number];
type RegisteredComponentInstance = DynamicComponentInstance;

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
  const components: Record<string, RegisteredComponentInstance> = {};
  addComponentsToLookup(components, query.allEntries, andInstances);
  addComponentsToLookup(components, query.anyEntries, orInstances);
  addComponentsToLookup(components, query.includeEntries, includeInstances);
  Object.freeze(components);

  // Initialize empty set for matching archetypes
  const archetypes = new Set<Archetype>();

  const bindings = `${createBindingID(query.allEntries, andInstances)}|${
    createBindingID(query.anyEntries, orInstances)
  }|${createBindingID(query.includeEntries, includeInstances)}`;
  const id = `${and.toString()}:${or.toString()}:${not.toString()}:${include.toString()}:${bindings}`;

  return { and, or, not, include, archetypes, components, isDirty: true, id };
}

/** The QueryManager is responsible for creating, registering, and destroying queries. */
export class QueryManager {
  /** Component registry accessors supplied by the owning World. */
  #dependencies: QueryManagerDependencies;

  /** Callback for refreshing query-to-archetype membership. */
  #ensureQueryMembership: (queries: MapIterator<QueryInstance>) => void;

  /** Callback for registering one query against existing archetypes. */
  #registerQueryMembership: (query: QueryInstance) => void;

  /** Cache for query results */
  readonly cache: QueryCache;

  /** Pool for reusing query result objects */
  readonly pool: QueryResultPool;

  /** Map of query IDs to their instances */
  readonly instancesByID: Map<string, QueryInstance>;

  /** Map of Query objects to their IDs */
  readonly idsByQuery: Map<Query, string>;

  /** Whether global query cache invalidation has already been recorded. */
  cacheInvalidated: boolean;

  /**
   * Create a new QueryManager
   * @param dependencies - Component registry accessors and lifecycle hooks
   */
  constructor(
    dependencies: QueryManagerDependencies,
    capacity: number,
    ensureQueryMembership: (queries: MapIterator<QueryInstance>) => void,
    registerQueryMembership: (query: QueryInstance) => void,
  ) {
    this.#dependencies = dependencies;
    this.#ensureQueryMembership = ensureQueryMembership;
    this.#registerQueryMembership = registerQueryMembership;
    this.pool = new QueryResultPool(capacity);
    this.cache = new QueryCache(this.pool);
    this.instancesByID = new Map();
    this.idsByQuery = new Map();
    this.cacheInvalidated = false;
  }

  /** Get components for a query */
  components(query: Query): Record<string, DynamicComponentInstance> {
    const instance = this.register(query);
    const queryId = instance.id;
    const result = this.cache.getComponents(
      queryId,
      () => instance.components,
    );
    return result;
  }

  /** Get entities for a query */
  entities(query: Query): IterableIterator<Entity> {
    return this.entityList(query).iterate();
  }

  /** Get entities for a query as a dense reusable list */
  entityList(query: Query): QueryEntityResult {
    const instance = this.register(query);
    const queryId = instance.id;
    this.ensureQueryMembership();

    const result = this.cache.getEntities(
      queryId,
      () => {
        const result = this.pool.acquireEntityResult();
        result.clear();
        for (const archetype of instance.archetypes) {
          archetype.writeEntitiesIntoResult(result);
        }
        return result;
      },
    );

    this.cacheInvalidated = false;

    return result;
  }

  /** Register a query */
  register(query: Query): QueryInstance {
    // Check if we already have an ID for this query
    let queryId = this.idsByQuery.get(query);

    // Return existing instance if we have one
    if (queryId && this.instancesByID.has(queryId)) {
      return this.instancesByID.get(queryId)!;
    }

    // Create new instance
    const instance: QueryInstance = createQueryInstance(
      this.#dependencies.getInstances,
      this.#dependencies.componentCount,
      query,
    );
    queryId = instance.id;
    const existing = this.instancesByID.get(queryId);
    if (existing) {
      this.idsByQuery.set(query, queryId);
      return existing;
    }

    // Store mappings
    this.idsByQuery.set(query, queryId);
    this.instancesByID.set(queryId, instance);

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
    this.#ensureQueryMembership(this.instancesByID.values());
  }

  /** Invalidate entity query caches after a committed entity/component transition. */
  invalidate(): void {
    if (!this.cacheInvalidated) {
      this.cache.invalidate();
      this.cacheInvalidated = true;
    }
  }
}
