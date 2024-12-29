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

import type { Schema, TypedArray, TypedArrayConstructor } from "@phughesmcr/partitionedbuffer";
export type { Schema, TypedArray, TypedArrayConstructor };

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

export type StorageProxyWithProperties<T> =
  & {
    [key in keyof T]: number;
  }
  & StorageProxy<T>;

/**
 * Internal component data storage
 */
export type SchemaStorage<T> = Readonly<{
  byteOffset: number;
  byteLength: number;
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

export type ComponentInstanceSpec<T extends SchemaOrNull> = {
  id: number;
  proxy: any; // T extends Schema<infer U> ? StorageProxyWithProperties<U> : null;
  storage: T extends Schema<infer U> ? SchemaStorage<U> : null;
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
  /** */
  archetypes: Set<Archetype>;
  /** */
  checkCandidacy: (target: number, idx: number) => boolean;
  /** */
  // deno-lint-ignore no-explicit-any
  components: Readonly<Record<string, ComponentInstance<any>>>;
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
