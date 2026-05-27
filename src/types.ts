/**
 * @module      types
 * @description Type definitions used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Partition, Schema, TypedArray, TypedArrayConstructor } from "@phughesmcr/partitionedbuffer";
import type { PartitionStorage } from "@phughesmcr/partitionedbuffer";
import type { BooleanArray } from "@phughesmcr/booleanarray";

import type { $_COMPONENT_ID_KEY, $_PARTITION_KEY, $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import type { Archetype } from "@/archetype/archetype.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Component } from "@/component/component.ts";
import type { StorageProxy } from "@/component/storage-proxy.ts";
import type { Query } from "@/query/query.ts";
import type { World } from "@/world/world.ts";

export type { Partition, PartitionStorage, Schema, TypedArray, TypedArrayConstructor };

/** An Entity is essentially just an ID number / pointer */
export type Entity = number;

/**
 * The specification for a StorageProxy
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxySpec<T> = {
  /** Mark the current entity as changed for this component. */
  markChanged(entity: Entity): void;
  /** The Partition data of the StorageProxy */
  storage: PartitionStorage<T>;
  /** The capacity of the World */
  capacity: number;
};

/**
 * A StorageProxy with properties
 * @param T The Schema / Partition type of the StorageProxy
 */
export type StorageProxyWithProperties<T extends SchemaOrNull> =
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
  components: DynamicComponentInstance[];
  /** The number of entities the Archetype can hold */
  capacity: number;
};

/** A Schema or null (null = tag component) */
export type SchemaOrNull<T = unknown> = Schema<T> | null;

/** Resolve the typed-array view type for one schema property definition */
type SchemaPropertyArray<T> = T extends TypedArrayConstructor ? InstanceType<T> :
  T extends [infer Constructor extends TypedArrayConstructor, number] ? InstanceType<Constructor> :
  never;

/** Typed-array partition views for a component schema */
export type SchemaPartitions<T extends Schema<T>> = {
  [K in keyof T]: SchemaPropertyArray<T[K]>;
};

/** A component definition whose schema is only known dynamically. */
export type DynamicComponent = Component<SchemaOrNull>;

/** A component instance whose schema is only known dynamically. */
export type DynamicComponentInstance = ComponentInstance<SchemaOrNull>;

/** A Record of ComponentInstances by Component name */
export type ComponentRecord<T extends SchemaOrNull = SchemaOrNull> = Record<string, ComponentInstance<T>>;

/** A type-safe component record for system callbacks */
export type TypedComponentRecord<T> = {
  [K in keyof T]: T[K] extends SchemaOrNull ? ComponentInstance<T[K]> : never;
};

/** A keyed map of component definitions used by typed system helpers. */
export type ComponentMap = Readonly<Record<string, DynamicComponent>>;

/** Extract the schema type from a Component definition. */
export type ComponentSchemaOf<TComponent> = TComponent extends Component<infer TSchema> ? TSchema : never;

/** Convert a keyed Component map into the world-local ComponentInstance record for that map. */
export type ComponentInstances<TMap extends ComponentMap> = {
  readonly [K in keyof TMap]: TMap[K] extends Component<infer TSchema> ?
    TSchema extends SchemaOrNull ? ComponentInstance<TSchema> : never :
    never;
};

/** The Component's constructor specification */
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
  & (T extends null ? {
      /** No schema for tag components */
      schema?: null;
    } :
    {
      /** The component's property definitions */
      schema: Schema<T>;
    });

/**
 * @internal
 * The private methods of a Component
 */
export interface ComponentPrivateMethods<T> {
  /** The stable id of the Component definition */
  readonly [$_COMPONENT_ID_KEY]: number;
  /** The Partition object of the Component */
  readonly [$_PARTITION_KEY]: Partition<T>;
}

/** The specification for a ComponentInstance */
export type ComponentInstanceSpec<T extends SchemaOrNull> = {
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
  all?: DynamicComponent[];
  /** `OR` - When present, gather entities that have at least one of these components */
  any?: DynamicComponent[];
  /** `NOT` - Gather entities as long as they don't have these components */
  none?: DynamicComponent[];
};

/** Keyed query specification used for typed query and system authoring. */
export type TypedQuerySpec<
  TAll extends ComponentMap = Record<never, never>,
  TAny extends ComponentMap = Record<never, never>,
  TNone extends ComponentMap = Record<never, never>,
> = {
  /** Components every matching entity must have. */
  all?: TAll;
  /** Components where at least one must be present when supplied. */
  any?: TAny;
  /** Components matching entities must not have. These are filters only. */
  none?: TNone;
};

/** Components exposed to a system callback for a typed query. */
export type QueryCallbackComponents<
  TAll extends ComponentMap,
  TAny extends ComponentMap,
> = TAll & TAny;

/** Dynamic query components used when a query is authored with component arrays. */
export type UntypedQueryComponents = Record<string, DynamicComponent>;

export type QueryInstance = {
  /** A BooleanArray for the AND match criteria */
  and: BooleanArray;
  /** The archetypes which match this query */
  archetypes: Set<Archetype>;
  /** The components which match this query */
  components: Readonly<Record<string, DynamicComponentInstance>>;
  /** The QueryInstance's unique identifier */
  id: string;
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

/** A borrowed, reusable entity iterator. */
export type BorrowedEntityIterator = IterableIterator<Entity>;

/** Read-only numeric index view for borrowed entity IDs. */
export type BorrowedEntityIndices = {
  /** Dense entity ID at `index`; only entries before the owning list's `count` are valid. */
  readonly [index: number]: Entity;
};

/**
 * A borrowed, reusable view of entity IDs.
 *
 * The view is pooled and valid only until the next world mutation, query
 * invalidation, or `world.refresh()`. Copy the valid prefix when a stable
 * snapshot is required.
 */
export type BorrowedEntityList = {
  /** Number of valid entity IDs in {@link BorrowedEntityList.indices}. */
  readonly count: number;
  /** Borrowed dense entity IDs. Read only entries `0 <= i < count`. */
  readonly indices: BorrowedEntityIndices;
};

/** Backwards-compatible name for the borrowed dense query result. */
export type QueryEntityList = BorrowedEntityList;

/** A Record of SystemInstances by System name */
export type SystemRecord = Readonly<Record<string, SystemInstance<SystemCallback>>>;

/**
 * The parameters of a function omitting the first two parameters
 * @author https://stackoverflow.com/a/67605309
 */
export type ParametersExceptFirstTwo<F extends SystemFunction> = Parameters<F> extends [
  unknown,
  unknown,
  ...infer R,
] ? R :
  [];

/**
 * Internal-compatible system function constraint.
 * @internal
 */
export type SystemFunction = (...args: never[]) => unknown;

/**
 * A multi-arity function where the first two parameters
 * are the components and borrowed dense entity list available
 * to the system respectively.
 */
export type SystemCallback = (
  components: ComponentRecord<SchemaOrNull>,
  entities: BorrowedEntityList,
  ...args: unknown[]
) => void | Promise<void>;

/** A typed system callback for component-map based system authoring. */
export type TypedSystemCallback<
  TComponents extends ComponentMap,
  TArgs extends unknown[] = [],
  TReturn = void,
> = (
  components: ComponentInstances<TComponents>,
  entities: BorrowedEntityList,
  ...args: TArgs
) => TReturn;

/**
 * The parameters of a SystemCallback excluding the first two parameters
 * which are always the components and entities
 */
export type SystemFunctionArgs<T extends SystemFunction> = ParametersExceptFirstTwo<T>;

/**
 * The specification for a System.
 * @param TComponents The query's typed component map
 * @param TArgs The parameters of the callback excluding the first two
 */
export type SystemSpec<
  TComponents extends ComponentMap = UntypedQueryComponents,
  TArgs extends unknown[] = unknown[],
  TReturn = void,
> = {
  /** The name of the system */
  name: string;
  /** The query which will provide the components and entities to the system. */
  query: Query<TComponents>;
  /** The core function of the system. Called when this.exec is called. */
  callback: TypedSystemCallback<TComponents, TArgs, TReturn>;
  /** The function to call when the system is initialized. */
  init?: (world: World) => void | Promise<void>;
  /** The function to call when the system is destroyed. */
  destroy?: (world: World) => void | Promise<void>;
};

/** The specification for the typed defineSystem helper. */
export type TypedSystemSpec<
  TAll extends ComponentMap,
  TAny extends ComponentMap,
  TNone extends ComponentMap,
  TArgs extends unknown[] = [],
  TReturn = void,
> = {
  /** The name of the system */
  name: string;
  /** Components every matching entity must have. */
  all?: TAll;
  /** Components where at least one must be present when supplied. */
  any?: TAny;
  /** Components matching entities must not have. These are filters only. */
  none?: TNone;
  /** The core function of the system. Called when the SystemInstance is called. */
  callback: TypedSystemCallback<TAll & TAny, TArgs, TReturn>;
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
  T extends SystemFunction,
  TReturn = ReturnType<T>,
  TArgs extends ParametersExceptFirstTwo<T> = ParametersExceptFirstTwo<T>,
> = (
  ...args: TArgs
) => TReturn;

export type {
  ComponentInstanceGetter,
  QueryManagerDependencies,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types/world-api.ts";
