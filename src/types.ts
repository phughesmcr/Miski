export type {
  BorrowedEntityIndices,
  BorrowedEntityIterator,
  BorrowedEntityList,
  BorrowedEntityListEachFn,
  BorrowedSlotIndices,
  Entity,
  EntityResultSink,
  QueryEntityList,
  SlotIndex,
} from "@/entity/entity.ts";
export {
  asEntity,
  asSlotIndex,
  entityGeneration,
  entityIndex,
  MAX_WORLD_CAPACITY,
  packEntity,
} from "@/entity/entity.ts";
export type {
  ComponentConstructor,
  ComponentInstances,
  ComponentMap,
  ComponentPrivateMethods,
  ComponentRecord,
  ComponentSpec,
  DynamicComponent,
  DynamicComponentInstance,
  EntityManagerSerialized,
  InferredDataComponentSpec,
  TagComponentSpec,
} from "@/types/component.ts";
export type {
  ComponentData,
  ComponentPartitions,
  ComponentValue,
  Partition,
  PartitionStorage,
  Schema,
  SchemaOrNull,
  SchemaProperty,
  SchemaPropertyArray,
  SchemaValues,
  StorageProxySpec,
  StorageProxyWithProperties,
  TypedArray,
  TypedArrayConstructor,
} from "@/types/partitions.ts";
export type {
  QueryInstance,
  QueryInstanceList,
  QuerySpec,
  TypedQuerySpec,
  UntypedQueryComponents,
} from "@/types/query.ts";
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
  ComponentSchema,
  ComponentsFromSchemaMap,
  RegistryFromMaps,
  SchemaComponentMap,
  TagMap,
  TagsFromMap,
  TagSpec,
} from "@/schema/schema.ts";
export type {
  DataStorageFromMap,
  EcsPrefabOptions,
  EcsWorldConfig,
  SpawnSpec,
  StorageFromMap,
  TagStorageFromMap,
} from "@/world/ecs-world.ts";
