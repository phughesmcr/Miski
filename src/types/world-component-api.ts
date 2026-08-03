import type { Component } from "@/component/component.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Entity, QueryEntityList } from "@/entity/entity.ts";
import type { Query } from "@/query/query.ts";
import type { ComponentBundle, ComponentBundleEntryInput } from "@/types/component-bundle.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import type { ComponentData, SchemaOrNull, SchemaValues } from "@/types/partitions.ts";

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
  addToEntity(component: Component<null, null> | string, entity: Entity): void;
  addToEntity<TValue extends Exclude<SchemaOrNull, null>, TStorage extends Exclude<SchemaOrNull, null> = TValue>(
    component: Component<TValue, TStorage>,
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
  addToEntities(component: Component<null, null> | string, entities: QueryEntityList): number;
  addToEntities<TValue extends Exclude<SchemaOrNull, null>, TStorage extends Exclude<SchemaOrNull, null> = TValue>(
    component: Component<TValue, TStorage>,
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
  getEntityData(component: string, entity: Entity): ComponentData<SchemaOrNull>;
  getEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage>, entity: Entity): ComponentData<TValue>;
  /**
   * Read the data of a component from an entity without throwing
   * @param component - The component to read the data for
   * @param entity - The entity to read the data for
   * @returns The data for the component, or `undefined` if the entity is inactive, does not own the component,
   * or the component is a tag component with no data storage
   * @throws {NotRegisteredError} - If the component is not registered
   */
  readEntityData(component: string, entity: Entity): ComponentData<SchemaOrNull> | undefined;
  readEntityData<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: Component<TValue, TStorage>,
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
  readEntityDataInto(
    component: string,
    entity: Entity,
    out: Partial<ComponentData<SchemaOrNull>>,
  ): boolean;
  readEntityDataInto<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(
    component: Component<TValue, TStorage>,
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
  getInstance(component: string): DynamicComponentInstance | undefined;
  getInstance<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage>): ComponentInstance<TValue, TStorage> | undefined;
  /**
   * Get a registered component instance
   * @param component - The component to get the instance for
   * @returns The registered instance of the component
   * @throws {NotRegisteredError} - If the component is not registered
   */
  require(component: string): DynamicComponentInstance;
  require<
    TValue extends SchemaOrNull,
    TStorage extends SchemaOrNull = TValue,
  >(component: Component<TValue, TStorage>): ComponentInstance<TValue, TStorage>;
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
  setEntityData<TValue extends Exclude<SchemaOrNull, null>, TStorage extends Exclude<SchemaOrNull, null> = TValue>(
    component: Component<TValue, TStorage>,
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
