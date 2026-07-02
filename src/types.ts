/**
 * @module      types
 * @description Public type re-exports for the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

export type { Entity } from "@/entity/entity-id.ts";
export type { EntityResultSink } from "@/entity/entity-result-sink.ts";
export type {
  ComponentInstances,
  ComponentMap,
  ComponentPrivateMethods,
  ComponentRecord,
  ComponentSpec,
  DynamicComponent,
  DynamicComponentInstance,
  EntityManagerSerialized,
} from "@/types/component.ts";
export type {
  BorrowedEntityIndices,
  BorrowedEntityIterator,
  BorrowedEntityList,
  QueryEntityList,
} from "@/types/entity-views.ts";
export type {
  ComponentPartitions,
  Partition,
  PartitionStorage,
  Schema,
  SchemaOrNull,
  SchemaPartitions,
  SchemaProperty,
  SchemaPropertyArray,
  SchemaValues,
  StorageProxySpec,
  StorageProxyWithProperties,
  TypedArray,
  TypedArrayConstructor,
} from "@/types/partitions.ts";
export type { QueryInstance, QuerySpec, TypedQuerySpec, UntypedQueryComponents } from "@/types/query.ts";
export type { SystemBindings } from "@/types/system-bindings.ts";
export type {
  ParametersExceptFirstTwo,
  SystemCallback,
  SystemFunction,
  SystemInstance,
  SystemPrivateMethods,
  SystemRecord,
  SystemSpec,
  TypedSystemCallback,
} from "@/types/system.ts";
export type {
  ComponentInstanceGetter,
  QueryManagerDependencies,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldContext,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types/world-api.ts";
