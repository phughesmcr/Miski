export type {
  BorrowedEntityIndices,
  BorrowedEntityIterator,
  BorrowedEntityList,
  BorrowedSlotIndices,
  Entity,
  EntityResultSink,
  QueryEntityList,
  SlotIndex,
} from "@/entity/entity.ts";
export { asSlotIndex, entityGeneration, entityIndex, MAX_WORLD_CAPACITY, packEntity } from "@/entity/entity.ts";
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
  ComponentData,
  ComponentPartitions,
  ComponentValue,
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
export type {
  ParametersExceptFirstTwo,
  SystemBindings,
  SystemCallback,
  SystemFunction,
  SystemInstance,
  SystemPrivateMethods,
  SystemRecord,
  SystemSpec,
  TypedSystemCallback,
} from "@/types/system.ts";
export type {
  ComponentBundle,
  ComponentBundleEntryFor,
  ComponentBundleEntryInput,
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
export type { CheckpointEntitySet, ComponentCheckpoint } from "@/checkpoint/checkpoint.ts";
export type { WorldRollbackPoint } from "@/rollback/rollback.ts";
export type {
  CompiledComponentEntry,
  CompiledComponentProperty,
  CompiledComponentSchema,
  ComponentsFromSchemaMap,
  SchemaComponentMap,
} from "@/schema/schema.ts";
export type { EcsWorldConfig, SpawnSpec, StorageFromMap } from "@/world/ecs-world.ts";
