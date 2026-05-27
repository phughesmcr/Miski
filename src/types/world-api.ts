/**
 * @module      types/world-api
 * @description Public World facade and lifecycle type definitions.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Query } from "@/query/query.ts";
import type { System } from "@/system/system.ts";
import type {
  BorrowedEntityIterator,
  BorrowedEntityList,
  DynamicComponent,
  DynamicComponentInstance,
  Entity,
  QueryEntityList,
  SchemaOrNull,
  SystemFunction,
  SystemInstance,
  SystemRecord,
} from "@/types.ts";

/** The specification for a World */
export type WorldSpec = {
  /** The maximum capacity of any World */
  capacity: number;
  /** The components to register in the World */
  components: DynamicComponent[];
};

/** The state of a World */
export type WorldState = "uninitialized" | "initialized" | "destroyed" | "error";

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
  /** Create an entity */
  create(): Entity | undefined;
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
   * Add a component to an entity
   * @param component - The component to add
   * @param entity - The entity to add the component to
   * @param data - The data to set for the component
   * @throws {NotRegisteredError} - If the component is not registered
   */
  addToEntity<T extends SchemaOrNull>(
    component: Component<T> | string,
    entity: Entity,
    data?: { [k in keyof T]: number },
  ): void;
  /**
   * Add a component to every entity in a dense query list
   * @param component - The component to add
   * @param entities - The dense entity list to mutate
   * @param data - The data to set for the component
   * @returns The number of entities whose ownership changed
   * @remarks Preflights the full list before mutating; inactive entities, duplicate entity IDs, and capacity failures
   * leave ownership, data, archetypes, changed state, and query caches unchanged.
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {EntityNotFoundError} - If any entity is inactive
   */
  addToEntities<T extends SchemaOrNull>(
    component: Component<T> | string,
    entities: QueryEntityList,
    data?: { [k in keyof T]: number },
  ): number;
  /**
   * Check if an entity has a component
   * @param component - The component to check for
   * @param entity - The entity to check
   * @returns `true` if the entity has the component, `false` otherwise
   */
  entityHas<T extends SchemaOrNull>(component: Component<T> | string, entity: Entity): boolean;
  /**
   * Get an iterable of all entities with one or more changed properties for a given component
   * @param component - The component to get changed entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getChanged<T extends SchemaOrNull>(component: Component<T> | string): IterableIterator<Entity> | undefined;
  /**
   * Get a stable snapshot of all entities with one or more changed properties for a component
   * @param component - The component to get changed entities for
   * @returns An array of entities or `undefined` if the component is not registered
   */
  getChangedSnapshot<T extends SchemaOrNull>(component: Component<T> | string): Entity[] | undefined;
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
  getEntityData<T extends SchemaOrNull>(component: Component<T> | string, entity: Entity): Record<keyof T, number>;
  /**
   * Check if a component is registered
   * @param component - The component to check
   * @returns `true` if the component is registered, `false` otherwise
   */
  isRegistered<T extends SchemaOrNull>(component: Component<T> | string): boolean;
  /**
   * Get the registered instance of a given component
   * @param component - The component to get the instance for
   * @returns The registered instance of the component or `undefined` if the component is not registered
   */
  getInstance<T extends SchemaOrNull>(component: Component<T> | string): ComponentInstance<T> | undefined;
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
  getOwners<T extends SchemaOrNull>(component: Component<T> | string): IterableIterator<Entity> | undefined;
  /**
   * Get a stable snapshot of all entities with a given component
   * @param component - The component to get entities for
   * @returns An array of entities or `undefined` if the component is not registered
   */
  getOwnersSnapshot<T extends SchemaOrNull>(component: Component<T> | string): Entity[] | undefined;
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
  removeFromEntity<T extends SchemaOrNull>(component: Component<T> | string, entity: Entity): void;
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
  removeFromEntities<T extends SchemaOrNull>(
    component: Component<T> | string,
    entities: QueryEntityList,
  ): number;
  /**
   * Set the data of a component for an entity
   * @param component - The component to set the data for
   * @param entity - The entity to set the data for
   * @param value - The data to set
   * @throws {EntityNotFoundError} - If the entity is inactive
   * @throws {NotRegisteredError} - If the component is not registered
   * @throws {ComponentDataError} - If the component has no data storage
   * @throws {ComponentOwnershipError} - If the active entity does not own the component
   */
  setEntityData<T extends SchemaOrNull>(
    component: Component<T> | string,
    entity: Entity,
    value?: Record<keyof T, number>,
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
  create<T extends SystemFunction>(system: System<T>): SystemInstance<T>;
  /** Get a system instance */
  get<T extends SystemFunction>(system: System<T> | string): SystemInstance<T> | undefined;
  /** Check if a system is registered */
  has<T extends SystemFunction>(system: System<T> | string): boolean;
  /** Destroy a system */
  destroy<T extends SystemFunction>(system: System<T> | string): Promise<void>;
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
