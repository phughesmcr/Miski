/**
 * @module      types
 * @description Type definitions used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Partition, Schema, TypedArray, TypedArrayConstructor } from "@phughesmcr/partitionedbuffer";
import type { PartitionStorage } from "@phughesmcr/partitionedbuffer";
import type { BooleanArray } from "@phughesmcr/booleanarray";

import type { Component } from "./component/Component.ts";
import type { Query } from "./query/Query.ts";
import type { World } from "./world/World.ts";
import type { System } from "./system/System.ts";
import type { ComponentInstance } from "./component/ComponentInstance.ts";
import type { Archetype } from "./archetype/Archetype.ts";
import type { StorageProxy } from "./component/StorageProxy.ts";
import type { $_PARTITION_KEY, $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "./constants.ts";

export type { PartitionStorage, Schema, TypedArray, TypedArrayConstructor };

/** An Entity is essentially just an ID number / pointer */
export type Entity = number;

/**
 * The specification for a StorageProxy
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxySpec<T> = {
  /** The BooleanArray of changed values */
  changed: BooleanArray;
  /** The Partition data of the StorageProxy */
  storage: PartitionStorage<T>;
  /** The capacity of the World */
  capacity: number;
};

/**
 * A StorageProxy with properties
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxyWithProperties<T extends SchemaOrNull<T>> =
  /** The StorageProxy */
  & StorageProxy<T>
  & {
    /** The properties of the StorageProxy */
    [key in keyof T]: number;
  };

/** The stringified JSON format of an EntityManager */
export type EntityManagerSerialized = {
  /** The maximum capacity of any EntityManager */
  MAX_CAPACITY: number;
  /** The capacity of the EntityManager */
  capacity: number;
  /** The entities in the EntityManager */
  entities: string;
};

/** The specification for an Archetype */
export type ArchetypeSpec = {
  /** The bitfield of the Archetype */
  bitfield?: BooleanArray;
  /** The components to include in the Archetype */
  components: ComponentInstance<any>[];
  /** The number of entities the Archetype can hold */
  capacity: number;
};

/** A Record of ComponentInstances by Component name */
export type ComponentRecord<T extends SchemaOrNull> = Record<
  string,
  T extends Schema<infer U> ? ComponentInstance<U> : ComponentInstance<null>
>;

/** A type-safe component record for system callbacks */
export type TypedComponentRecord<T> = {
  [K in keyof T]: T[K] extends SchemaOrNull ? ComponentInstance<T[K]> : never;
};

/** A Schema or null (null = tag component) */
export type SchemaOrNull<T = any> = Schema<T> | null;

/** The Component's construct`or specification */
export type ComponentSpec<T extends SchemaOrNull = null> =
  & {
    /** The component's label */
    name: string;

    /**
     * The maximum number of entities able to equip this component per world.
     *
     * __Warning__: use this only where memory use is a concern, performance will be worse.
     */
    maxEntities?: number | null;
  }
  & (T extends Schema<any> ? {
      /** The component's property definitions */
      schema: Schema<T>;
    }
    : {
      /** No schema for tag components */
      schema?: null;
    });

/**
 * @internal
 * The private methods of a Component
 */
export interface ComponentPrivateMethods<T> {
  /** The Partition object of the Component */
  readonly [$_PARTITION_KEY]: Partition<T>;
}

/** The specification for a ComponentInstance */
export type ComponentInstanceSpec<T extends SchemaOrNull<T>> = {
  /** The unique identifier of the ComponentInstance */
  id: number;
  /** The StorageProxy of the ComponentInstance */
  proxy: T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;
  /** The storage of the ComponentInstance */
  storage: T extends Schema<infer U> ? PartitionStorage<U> : null;
  /** The Component of the ComponentInstance */
  type: Component<T>;
};

/** The Query constructor specification */
export type QuerySpec = {
  /** `AND` - Gather entities as long as they have all these components */
  all?: Component<SchemaOrNull<any>>[];
  /** `OR` - Gather entities as long as they have 0...* of these components */
  any?: Component<SchemaOrNull<any>>[];
  /** `NOT` - Gather entities as long as they don't have these components */
  none?: Component<SchemaOrNull<any>>[];
};

export type QueryInstance = {
  /** A BooleanArray for the AND match criteria */
  and: BooleanArray;
  /** The archetypes which match this query */
  archetypes: Set<Archetype>;
  /** The components which match this query */
  components: Readonly<Record<string, ComponentInstance<any>>>;
  /** The QueryInstance's unique identifier */
  id: string;
  /**
   * @param target
   * @param idx
   * @returns
   */
  isCandidate: (target: number, idx: number) => boolean;
  /**
   * `true` if the object is in a dirty state
   *
   * A query becomes dirty when an archetype is added or removed
   */
  isDirty: boolean;
  /** A BooleanArray for the OR match criteria */
  or: BooleanArray;
  /** A BooleanArray for the NOT match criteria */
  not: BooleanArray;
};

/** A Record of SystemInstances by System name */
export type SystemRecord = Record<string, SystemInstance<any, any>>;

/**
 * The parameters of a function omitting the first two parameters
 * @author https://stackoverflow.com/a/67605309
 */
export type ParametersExceptFirstTwo<F> = F extends (arg0: any, arg1: any, ...rest: infer R) => any ? R : never;

/**
 * A multi-arity function where the first two parameters
 * are the components and entities available to
 * the system respectively.
 */
export type SystemCallback = (
  components: ComponentRecord<any>,
  entities: IterableIterator<Entity>,
  ...args: any[]
) => void | Promise<void>;

/**
 * The parameters of a SystemCallback excluding the first two parameters
 * which are always the components and entities
 */
export type SystemFunctionArgs<T extends SystemCallback> = ParametersExceptFirstTwo<T>;

/**
 * The specification for a System.
 * @param T The callback's type
 * @param U The parameters of the callback excluding the first two (which are always the components and entities)
 */
export type SystemSpec<T extends SystemCallback> = {
  /** The name of the system */
  name: string;
  /** The query which will provide the components and entities to the system. */
  query: Query;
  /** The core function of the system. Called when this.exec is called. */
  callback: T;
  /** The function to call when the system is initialized. */
  init?: (world: World) => void | Promise<void>;
  /** The function to call when the system is destroyed. */
  destroy?: (world: World) => void | Promise<void>;
};

/**
 * @internal
 * The private methods of a System
 */
export interface SystemPrivateMethods {
  [$_SYSTEM_INIT_KEY]: (world: World) => void | Promise<void>;
  [$_SYSTEM_DESTROY_KEY]: (world: World) => void | Promise<void>;
}

/**
 * A SystemInstance is the System.callback bound to the world
 *
 * SystemInstances are convenience functions that memoize the components and entities for the system
 *
 * @param T The callback's type
 * @param U The parameters of the callback excluding the first two (which are always the components and entities)
 */
export type SystemInstance<
  T extends SystemCallback,
  TReturn = void,
  TArgs extends ParametersExceptFirstTwo<T> = ParametersExceptFirstTwo<T>,
> = (
  ...args: TArgs
) => TReturn;

/** The specification for a World */
export type WorldSpec = {
  /** The maximum capacity of any World */
  capacity: number;
  /** The components to register in the World */
  components: Component<SchemaOrNull<any>>[];
};

/** The state of a World */
export type WorldState = "uninitialized" | "initialized" | "destroyed" | "error";

export type WorldArchetypeAPI = {
  /** Get the archetype ID of an entity */
  getEntityArchetype: (entity: Entity) => string | undefined;
  /** Check if an entity is in the root (empty) archetype */
  isEntityInRoot(entity: Entity): boolean;
  /** Get the components associated with a QueryInstance */
  queryComponents(query: Query): Record<string, ComponentInstance<any>>;
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
  getActive(startEntity?: Entity, endEntity?: Entity): IterableIterator<Entity>;
  /** Get the number of active entities */
  getActiveCount(): number;
  /** Get the number of available entities */
  getAvailableCount(): number;
  /** Check if an entity is active */
  isActive(entity: Entity): boolean;
  /** Check if an entity is valid */
  isEntity(entity: Entity): boolean;
  /** Query for entities */
  query(query: Query): IterableIterator<Entity>;
};

/** The public Component management API */
export type WorldComponentAPI = {
  /** The number of components registered */
  readonly count: number;
  /** A Record of ComponentInstances by Component name */
  readonly registry: Record<string, ComponentInstance<any>>;
  /**
   * Add a component to an entity
   * @param component - The component to add
   * @param entity - The entity to add the component to
   * @param data - The data to set for the component
   * @throws {NotRegisteredError} - If the component is not registered
   */
  addToEntity<T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
    data?: { [k in keyof T]: number },
  ): void;
  /**
   * Check if an entity has a component
   * @param component - The component to check for
   * @param entity - The entity to check
   * @returns `true` if the entity has the component, `false` otherwise
   */
  entityHas<T extends SchemaOrNull<T>>(component: Component<T> | string, entity: Entity): boolean;
  /**
   * Get an iterable of all entities with one or more changed properties for a given component
   * @param component - The component to get changed entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getChanged<T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined;
  /**
   * Get the data of a component from an entity
   * @param component - The component to get the data for
   * @param entity - The entity to get the data for
   * @returns The data for the component or `undefined` if the component is not registered
   */
  getEntityData<T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
  ): Record<keyof T, number> | undefined;
  /**
   * Check if a component is registered
   * @param component - The component to check
   * @returns `true` if the component is registered, `false` otherwise
   */
  isRegistered<T extends SchemaOrNull<T>>(component: Component<T> | string): boolean;
  /**
   * Get the registered instance of a given component
   * @param component - The component to get the instance for
   * @returns The registered instance of the component or `undefined` if the component is not registered
   */
  getInstance<T extends SchemaOrNull<T>>(component: Component<T> | string): ComponentInstance<T> | undefined;
  /**
   * Get instances for an array of components
   * @param array - The array of components to get instances for
   * @returns An array of component instances
   */
  getInstances(
    array: Component<SchemaOrNull<any>>[] | Readonly<Component<SchemaOrNull<any>>[]>,
  ): (ComponentInstance<SchemaOrNull<any>> | undefined)[];
  /**
   * Get an iterable of all entities with a given component
   * @param component - The component to get entities for
   * @returns An iterable of entities or `undefined` if the component is not registered
   */
  getOwners<T extends SchemaOrNull<T>>(component: Component<T> | string): IterableIterator<Entity> | undefined;
  /**
   * Query for components
   * @param query - The query to use
   * @returns A Record of ComponentInstances by Component name
   */
  query(query: Query): Record<string, ComponentInstance<SchemaOrNull<any>>>;
  /**
   * Remove a component from an entity
   * @param component - The component to remove
   * @param entity - The entity to remove the component from
   * @throws {NotRegisteredError} - If the component is not registered
   */
  removeFromEntity<T extends SchemaOrNull<T>>(component: Component<T> | string, entity: Entity): void;
  /**
   * Set the data of a component for an entity
   * @param component - The component to set the data for
   * @param entity - The entity to set the data for
   * @param value - The data to set
   */
  setEntityData<T extends SchemaOrNull<T>>(
    component: Component<T> | string,
    entity: Entity,
    value?: Record<keyof T, number>,
  ): void;
};

/** A function that gets ComponentInstances from an array of Components */
export type ComponentInstanceGetter = WorldComponentAPI["getInstances"];

/** The public System management API */
export type WorldSystemAPI = {
  /** The systems by name */
  readonly registry: SystemRecord;
  /** Create a system */
  create<T extends SystemCallback>(system: System<T>): SystemInstance<T>;
  /** Get a system instance */
  get<T extends SystemCallback>(system: System<T> | string): SystemInstance<T> | undefined;
  /** Check if a system is registered */
  has<T extends SystemCallback>(system: System<T> | string): boolean;
  /** Destroy a system */
  destroy<T extends SystemCallback>(system: System<T> | string): Promise<void>;
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
