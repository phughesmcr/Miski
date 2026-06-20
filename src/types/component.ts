/**
 * @module      types/component
 * @description Component-related type definitions.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Partition, Schema } from "@phughesmcr/partitionedbuffer";

import type { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Component } from "@/component/component.ts";
import type { PartitionStorage, SchemaOrNull, StorageProxyWithProperties } from "@/types/partitions.ts";

/** The stringified JSON format of an EntityManager */
export type EntityManagerSerialized = {
  /** The maximum capacity of any EntityManager */
  MAX_CAPACITY: number;
  /** The capacity of the EntityManager */
  capacity: number;
  /** The entities in the EntityManager */
  entities: string;
};

/** A component definition whose schema is only known dynamically. */
export type DynamicComponent = Component<SchemaOrNull>;

/** A component instance whose schema is only known dynamically. */
export type DynamicComponentInstance = ComponentInstance<SchemaOrNull>;

/** A Record of ComponentInstances by Component name */
export type ComponentRecord<T extends SchemaOrNull = SchemaOrNull> = Record<string, ComponentInstance<T>>;

/** A keyed map of component definitions used by typed query specs. */
export type ComponentMap = Readonly<Record<string, DynamicComponent>>;

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
