/**
 * @module      types/world-api
 * @description Public World facade and lifecycle type definitions.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Entity } from "@/entity/entity-id.ts";
import type { Query } from "@/query/query.ts";
import type { System } from "@/system/system.ts";
import type { ComponentMap, DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import type { ComponentData, SchemaOrNull, SchemaValues } from "@/types/partitions.ts";
import type { BorrowedEntityIterator, BorrowedEntityList, QueryEntityList } from "@/types/entity-views.ts";
import type { SystemInstance, SystemRecord, TypedSystemCallback } from "@/types/system.ts";

/** The specification for a World */
export type WorldSpec = {
  /** The maximum capacity of any World */
  capacity: number;
  /** The components to register in the World */
  components: DynamicComponent[];
};

/** Runtime-compatible component bundle tuple. */
export type ComponentBundleEntryInput =
  | readonly [DynamicComponent]
  | readonly [DynamicComponent, Partial<Record<string, number>>];

/** A bundle tuple checked against one concrete component definition. */
export type ComponentBundleEntryFor<TComponent extends DynamicComponent> = TComponent extends
  Component<infer TValue, infer TStorage> ? TStorage extends null ? readonly [TComponent] :
  readonly [TComponent] | readonly [TComponent, Partial<SchemaValues<TValue>>] :
  never;

/** A component bundle whose entries are checked component-by-component. */
export type ComponentBundle<TBundle extends readonly ComponentBundleEntryInput[]> = {
  readonly [I in keyof TBundle]: TBundle[I] extends readonly [infer TComponent extends DynamicComponent] ?
    ComponentBundleEntryFor<TComponent> :
    TBundle[I] extends readonly [infer TComponent extends DynamicComponent, unknown] ?
      ComponentBundleEntryFor<TComponent> :
    never;
};

/** The state of a World */
export type WorldState = "uninitialized" | "initialized" | "destroyed" | "error";

/** Public world surface available to systems and external callers. */
export type WorldContext = {
  readonly state: WorldState;
  readonly components: WorldComponentAPI;
  readonly entities: WorldEntityAPI;
  readonly systems: WorldSystemAPI;
  readonly archetypes: WorldArchetypeAPI;
  init(): Promise<void>;
  destroy(): Promise<void>;
  refresh(): void;
};

/** The public archetype transition and query membership API. */
export type WorldArchetypeAPI = {
  /** Get the archetype ID of an entity */
  getEntityArchetype: (entity: Entity) => string | undefined;
  /** Check if an entity is in the root (empty) archetype */
  isEntityInRoot(entity: Entity): boolean;
  /** Get the components associated with a QueryInstance */
  queryComponents(query: Query): Record<string, DynamicComponentInstance>;
  /** Get the entities associated with a QueryInstance */
  queryEntities(query: Query): IterableIterator<Entity>;
  /** Get entities that entered a query since last refresh */
  queryEntered(query: Query): IterableIterator<Entity>;
  /** Get entities that exited a query since last refresh */
  queryExited(query: Query): IterableIterator<Entity>;
};

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

/** The public Component management API */
export type WorldComponentAPI = {
  /** The number of components registered */
  readonly count: number;
  /** A Record of ComponentInstances by Component name */
  readonly registry: Readonly<Record<string, DynamicComponentInstance>>;
  /**
   * Add a component to an entity, or update its data if already owned (upsert)
   * @param component - The component to add
   * @param entity - The entity to add the component to
   * @param data - The data to set for the component; omitted keys keep their current values
   * @remarks If the entity already owns the component, ownership is unchanged and any provided data is merged.
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {EntityNotFoundError} - If the entity is inactive
   */
  addToEntity<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
    data?: Partial<SchemaValues<TValue>>,
  ): void;
  /**
   * Add a component to every entity in a dense query list, updating data for entities that already own it (upsert)
   * @param component - The component to add
   * @param entities - The dense entity list to mutate
   * @param data - The data to set for the component; omitted keys keep their current values
   * @returns The number of entities whose ownership changed
   * @remarks Preflights the full list before mutating; inactive entities, duplicate entity IDs, and capacity failures
   * leave ownership, data, archetypes, changed state, and query caches unchanged.
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {EntityNotFoundError} - If any entity is inactive
   */
  addToEntities<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entities: QueryEntityList,
    data?: Partial<SchemaValues<TValue>>,
  ): number;
  /**
   * Add or update a component bundle on one active entity.
   * @param entity - The entity to mutate
   * @param bundle - Unique component tuples, with optional data for data components
   * @throws {NotRegisteredError} - If any component is not registered
   * @throws {EntityNotFoundError} - If the entity is inactive
   */
  addBundle<const TBundle extends readonly ComponentBundleEntryInput[]>(
    entity: Entity,
    bundle: TBundle & ComponentBundle<TBundle>,
  ): void;
  /**
   * Check if an entity has a component
   * @param component - The component to check for
   * @param entity - The entity to check
   * @returns `true` if the entity has the component, `false` otherwise
   */
  entityHas<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
  ): boolean;
  /**
   * Get an iterable of all entities with one or more changed properties for a given component
   * @param component - The component to get changed entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getChanged<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
  ): IterableIterator<Entity> | undefined;
  /**
   * Get a stable snapshot of all entities with one or more changed properties for a component
   * @param component - The component to get changed entities for
   * @returns An array of entities or `undefined` if the component is not registered
   */
  getChangedSnapshot<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
  ): Entity[] | undefined;
  /**
   * Get the data of a component from an entity
   * @param component - The component to get the data for
   * @param entity - The entity to get the data for
   * @returns The data for the component
   * @throws {EntityNotFoundError} - If the entity is inactive
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {ComponentDataError} - If the component has no data storage
   * @throws {ComponentOwnershipError} - If the active entity does not own the component
   */
  getEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string, entity: Entity): ComponentData<TValue>;
  /**
   * Read the data of a component from an entity without throwing
   * @param component - The component to read the data for
   * @param entity - The entity to read the data for
   * @returns The data for the component, or `undefined` if the entity is inactive, does not own the component,
   * or the component is a tag component with no data storage
   * @throws {NotRegisteredError} - If the component is not registered
   */
  readEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
  ): ComponentData<TValue> | undefined;
  /**
   * Read component data into a caller-owned object without allocating.
   * @param component - The component to read
   * @param entity - The entity to read
   * @param out - Object to overwrite with all component keys on success
   * @returns `true` when data was written; `false` for inactive entities, non-owners, and tag components
   * @throws {NotRegisteredError} - If the component is not registered
   */
  readEntityDataInto<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
    out: Partial<ComponentData<TValue>>,
  ): boolean;
  /**
   * Check if a component is registered
   * @param component - The component to check
   * @returns `true` if the component is registered, `false` otherwise
   */
  isRegistered<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
  ): boolean;
  /**
   * Get the registered instance of a given component
   * @param component - The component to get the instance for
   * @returns The registered instance of the component or `undefined` if the component is not registered
   */
  getInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): ComponentInstance<TValue, TStorage> | undefined;
  /**
   * Get a registered component instance
   * @param component - The component to get the instance for
   * @returns The registered instance of the component
   * @throws {NotRegisteredError} - If the component is not registered
   */
  require<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage> | string): ComponentInstance<TValue, TStorage>;
  /**
   * Mark an owning data component entity as changed.
   * @throws {EntityNotFoundError} - If the entity is inactive
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {ComponentDataError} - If the component has no data storage
   * @throws {ComponentOwnershipError} - If the active entity does not own the component
   */
  markChanged<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
  ): void;
  /**
   * Get instances for an array of components
   * @param array - The array of components to get instances for
   * @returns An array of component instances
   */
  getInstances(
    array: DynamicComponent[] | Readonly<DynamicComponent[]>,
  ): (DynamicComponentInstance | undefined)[];
  /**
   * Get an iterable of all entities with a given component
   * @param component - The component to get entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getOwners<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
  ): IterableIterator<Entity> | undefined;
  /**
   * Get a stable snapshot of all entities with a given component
   * @param component - The component to get entities for
   * @returns An array of entities or `undefined` if the component is not registered
   */
  getOwnersSnapshot<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
  ): Entity[] | undefined;
  /**
   * Query for components
   * @param query - The query to use
   * @returns A Record of ComponentInstances by Component name
   */
  query(query: Query): Record<string, DynamicComponentInstance>;
  /**
   * Remove a component from an entity
   * @param component - The component to remove
   * @param entity - The entity to remove the component from
   * @remarks Active entities that do not own the component are skipped idempotently.
   * @throws {EntityNotFoundError} - If the entity is inactive
   * @throws {NotRegisteredError} - If the component is not registered
   */
  removeFromEntity<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
  ): void;
  /**
   * Remove a component from every entity in a dense query list
   * @param component - The component to remove
   * @param entities - The dense entity list to mutate
   * @returns The number of entities whose ownership changed
   * @remarks Preflights the full list before mutating; inactive entities and duplicate entity IDs leave ownership,
   * data, archetypes, changed state, and query caches unchanged. Active non-owners are skipped idempotently.
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {EntityNotFoundError} - If any entity is inactive
   */
  removeFromEntities<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entities: QueryEntityList,
  ): number;
  /**
   * Set the data of a component for an entity
   * @param component - The component to set the data for
   * @param entity - The entity to set the data for
   * @param value - The data to set; omitted keys keep their current values (partial update)
   * @throws {EntityNotFoundError} - If the entity is inactive
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {ComponentDataError} - If the component has no data storage
   * @throws {ComponentOwnershipError} - If the active entity does not own the component
   */
  setEntityData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage> | string,
    entity: Entity,
    value: Partial<SchemaValues<TValue>>,
  ): void;
};

/** A function that gets ComponentInstances from an array of Components */
export type ComponentInstanceGetter = WorldComponentAPI["getInstances"];

/** Internal dependencies supplied by a World to its QueryManager. */
export type QueryManagerDependencies = {
  /** Get registered component instances for a query's component definitions. */
  getInstances: ComponentInstanceGetter;
  /** Number of registered component instances in the world. */
  componentCount: number;
  /** Whether the owning world has completed initialization. */
  isInitialized(): boolean;
};

/** The public System management API */
export type WorldSystemAPI = {
  /** The systems by name */
  readonly registry: SystemRecord;
  /** Create a system */
  create<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn>): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>;
  /** Get a system instance */
  get<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(
    system: System<TComponents, TArgs, TReturn> | string,
  ): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>> | undefined;
  /** Check if a system is registered */
  has<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): boolean;
  /** Destroy a system */
  destroy<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): Promise<void>;
};

/** The result of a World API constructor */
export type WorldAPIResult = {
  /** The Archetype API */
  archetypes: WorldArchetypeAPI;
  /** The Component API */
  components: WorldComponentAPI;
  /** The Entity API */
  entities: WorldEntityAPI;
  /** The System API */
  systems: WorldSystemAPI;
};
