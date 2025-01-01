/**
 * @module      types
 * @description Type definitions used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Component } from "./component/Component.ts";
import type { Query } from "./query/Query.ts";
import type { World } from "./world/World.ts";
import type { System } from "./system/System.ts";
import type { ComponentInstance } from "./component/ComponentInstance.ts";
import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { Archetype } from "./archetype/Archetype.ts";
import type { StorageProxy } from "./component/StorageProxy.ts";
import type { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "./constants.ts";

import type { Partition, Schema, TypedArray, TypedArrayConstructor } from "@phughesmcr/partitionedbuffer";
export type { Schema, TypedArray, TypedArrayConstructor };

/**
 * The specification for a StorageProxy
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxySpec<T> = {
  /** The BooleanArray of changed values */
  changed: BooleanArray;
  /** The Partition data of the StorageProxy */
  storage: Partition<T>;
};

/**
 * A StorageProxy with properties
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxyWithProperties<T> =
  & {
    /** The properties of the StorageProxy */
    [key in keyof T]: number;
  }
  /** The StorageProxy */
  & StorageProxy<T>;

/** An Entity is essentially just an ID number / pointer */
export type Entity = number;

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

/** Internal component data storage */
export type SchemaStorage<T> = Readonly<{
  /** The byte offset of the StorageProxy */
  byteOffset: number;
  /** The byte length of the StorageProxy */
  byteLength: number;
  /** The storage of the StorageProxy */
  storage: Readonly<Record<keyof T, TypedArray>>;
}>;

/** A Record of ComponentInstances by Component name */
export type ComponentRecord = Record<string, ComponentInstance<SchemaOrNull>>;

/** A Schema or null (null = tag component) */
// deno-lint-ignore no-explicit-any
export type SchemaOrNull = Schema<any> | null;

/** The Component's construct`or specification */
export type ComponentSpec<T extends SchemaOrNull> =
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
  // deno-lint-ignore no-explicit-any
  & (T extends Schema<any> ? {
      /** The component's property definitions */
      schema: Schema<T>;
    }
    : {
      /** No schema for tag components */
      schema?: null;
    });

/** The specification for a ComponentInstance */
export type ComponentInstanceSpec<T extends SchemaOrNull> = {
  /** The unique identifier of the ComponentInstance */
  id: number;
  /** The StorageProxy of the ComponentInstance */
  proxy: any; // T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;
  /** The storage of the ComponentInstance */
  storage: T extends Schema<infer U> ? SchemaStorage<U> : null;
  /** The Component of the ComponentInstance */
  type: Component<T>;
};

/** The Query constructor specification */
export type QuerySpec = {
  /** `AND` - Gather entities as long as they have all these components */
  all?: Component<SchemaOrNull>[];
  /** `OR` - Gather entities as long as they have 0...* of these components */
  any?: Component<SchemaOrNull>[];
  /** `NOT` - Gather entities as long as they don't have these components */
  none?: Component<SchemaOrNull>[];
};

export type QueryInstance = {
  /** A BooleanArray for the AND match criteria */
  and: BooleanArray;
  /** The archetypes which match this query */
  archetypes: Set<Archetype>;
  /** The components which match this query */
  // deno-lint-ignore no-explicit-any
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
export type SystemCallback<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> = (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: U) => ReturnType<T>;

/**
 * The specification for a System.
 * @param T The callback's type
 * @param U The parameters of the callback excluding the first two (which are always the components and entities)
 */
export interface SystemSpec<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> {
  /** The name of the system */
  name: string;
  /** The query which will provide the components and entities to the system. */
  query: Query;
  /** The core function of the system. Called when this.exec is called. */
  callback: SystemCallback<T, U>;
  /** The function to call when the system is initialized. */
  init?: (world: World) => void | Promise<void>;
  /** The function to call when the system is destroyed. */
  destroy?: (world: World) => void | Promise<void>;
}

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
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> = (...args: U) => ReturnType<T>;

/** The specification for a World */
export type WorldSpec = {
  /** The maximum capacity of any World */
  capacity: number;
  /** The components to register in the World */
  components: Component<SchemaOrNull>[];
};

/** The state of a World */
export type WorldState = "uninitialized" | "initialized" | "destroyed";

/** The public Entity management API */
export type WorldEntityAPI = {
  /** Create an entity */
  create(): Entity | undefined;
  /** Destroy an entity */
  destroy(entity: Entity): World;
  /** Check if an entity exists */
  exists(entity: Entity): boolean;
  /** Query for entities */
  query(query: Query): IterableIterator<Entity>;
};

/** The public Component management API */
export type WorldComponentAPI = {
  /** Add a component to an entity */
  addToEntity<T extends SchemaOrNull>(component: Component<T>, entity: Entity): void;
  /** Check if an entity has a component */
  entityHas<T extends SchemaOrNull>(component: Component<T>, entity: Entity): boolean;
  /** Get all the component instances associated with an entity */
  fromEntity<T extends SchemaOrNull>(entity: Entity): Record<string, ComponentInstance<T>>;
  /** Get a component from the World */
  get<T extends SchemaOrNull>(component: Component<T> | string): ComponentInstance<T> | undefined;
  /** Get the data of a component from an entity */
  getData<T extends SchemaOrNull>(component: Component<T> | string, entity: Entity): T | undefined;
  /** Check if a component is registered */
  isRegistered<T extends SchemaOrNull>(component: Component<T> | string): boolean;
  /** Query for components */
  query<T extends SchemaOrNull>(query: Query): Record<string, ComponentInstance<T>>;
  /** Remove a component from an entity */
  removeFromEntity<T extends SchemaOrNull>(component: Component<T>, entity: Entity): void;
  /** Set the data of a component for an entity */
  setData<T extends SchemaOrNull>(component: Component<T> | string, entity: Entity, value?: T): void;
  /** The number of components registered */
  count: number;
  /** The ComponentInstances by name */
  registry: ComponentRecord;
};

/** The public System management API */
export type WorldSystemAPI = {
  /** Create a system */
  create<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(system: System<T, U>): SystemInstance<T, U>;
  /** Get a system instance */
  get<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(system: System<T, U> | string): SystemInstance<T, U> | undefined;
  /** Check if a system is registered */
  has<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(system: System<T, U> | string): boolean;
  /** Destroy a system */
  destroy<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(system: System<T, U> | string): void;
  /** The systems by name */
  registry: SystemRecord;
};
