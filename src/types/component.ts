import type { Partition, Schema, SchemaProperty } from "@phughesmcr/partitionedbuffer";

import type { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Component } from "@/component/component.ts";
import type { Entity } from "@/entity/entity.ts";
import type { PartitionStorage, SchemaOrNull, StorageProxyWithProperties } from "@/types/partitions.ts";

/** The stringified JSON format of an EntityManager */
export type EntityManagerSerialized = {
  /** The maximum capacity of any EntityManager */
  MAX_CAPACITY: number;
  /** The capacity of the EntityManager */
  capacity: number;
  /** The entities in the EntityManager */
  entities: string;
  /** Optional per-slot generation counters */
  generations?: string;
};

/** A component definition whose value/storage shape is only known dynamically. */
export type DynamicComponent = Component<SchemaOrNull, SchemaOrNull>;

/** A component instance whose schema is only known dynamically. */
export type DynamicComponentInstance = ComponentInstance<SchemaOrNull, SchemaOrNull>;

/** A Record of ComponentInstances by Component name */
export type ComponentRecord<T extends SchemaOrNull = SchemaOrNull> = Record<string, ComponentInstance<T, T>>;

/** A keyed map of component definitions used by typed query specs. */
export type ComponentMap = Readonly<Record<string, DynamicComponent>>;

/** Convert a keyed Component map into the world-local ComponentInstance record for that map. */
export type ComponentInstances<TMap extends ComponentMap> = {
  readonly [K in keyof TMap]: TMap[K] extends Component<infer TValue, infer TStorage> ?
    TValue extends SchemaOrNull ? TStorage extends SchemaOrNull ? ComponentInstance<TValue, TStorage> : never :
    never :
    never;
};

/** The Component's constructor specification */
export type ComponentSpec<
  TValue extends SchemaOrNull = null,
  TStorage extends SchemaOrNull = TValue,
> =
  & (
    [TValue, TStorage] extends [null, null] ? unknown :
      TValue extends null ? never :
      TStorage extends null ? never :
      [
        Exclude<keyof TValue, keyof TStorage> | Exclude<keyof TStorage, keyof TValue>,
      ] extends [never] ? TValue extends object ? {
            [K in keyof TValue]: TValue[K] extends number | SchemaProperty ? true : false;
          }[keyof TValue] extends false ? never : unknown :
        never :
      never
  )
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
  & (TStorage extends null ? {
      /** No schema for tag components */
      schema?: null;
    } :
    {
      /** The component's property definitions */
      schema: Schema<TStorage>;
    });

/**
 * @internal
 * The private methods of a Component
 */
export interface ComponentPrivateMethods<TStorage> {
  /** The stable id of the Component definition */
  readonly [$_COMPONENT_ID_KEY]: number;
  /** The Partition object of the Component */
  readonly [$_PARTITION_KEY]: Partition<TStorage>;
}

/** The specification for a ComponentInstance */
export type ComponentInstanceSpec<
  TValue extends SchemaOrNull,
  TStorage extends SchemaOrNull = TValue,
> = {
  /** The unique identifier of the ComponentInstance */
  id: number;
  /** Direct ownership check */
  has(entity: Entity): boolean;
  /** Ownership-guarded changed marker */
  markChanged(entity: Entity): boolean;
  /** Optional revision provider */
  getRevision?: () => number;
  /** The StorageProxy of the ComponentInstance */
  proxy: TStorage extends null ? null : StorageProxyWithProperties<TValue>;
  /** The storage of the ComponentInstance */
  storage: TStorage extends null ? null : PartitionStorage<TStorage>;
  /** The Component of the ComponentInstance */
  type: Component<TValue, TStorage>;
};
