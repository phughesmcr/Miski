/**
 * @module      Miski
 * @description A sweet ECS library for TypeScript.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 *
 * Public surface tiers:
 * - **Core** - World, Component, Query, System, entity handles, errors
 * - **Hot-path** - dense `queryList`, direct `.storage.partitions` writes, `frame`
 * - **Tooling** - `createEcsWorld`, schema hash, checkpoints, rollback, canonicalize
 *
 * Prefer `.storage.partitions` for SoA access (`.partitions` is an alias).
 * Index typed arrays by storage slot via `entityIndex(entity)` or `queryList` `indices`,
 * not by the packed entity handle.
 *
 * ## Core
 *
 * @example Create Components
 * ```ts
 * // Schema uses typed-array constructors (storage shape).
 * type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };
 * const positionComponent = new Component<Vec2>({
 *   name: "position",
 *   schema: {
 *     x: Float32Array,
 *     y: Float32Array,
 *   },
 * });
 * ```
 *
 * @example Create a component with branded writes and exact storage partitions
 * ```ts
 * // TValue = what callers may write; TStorage = runtime typed-array schema.
 * type FacingValue = { dir: 0 | 1 | 2 | 3 };
 * type FacingStorage = { dir: Uint8ArrayConstructor };
 * const facingComponent = new Component<FacingValue, FacingStorage>({
 *   name: "facing",
 *   schema: { dir: Uint8Array },
 * });
 * ```
 *
 * @example Create, initialize, refresh, and destroy a World
 * ```ts
 * // capacity: minimum 8, maximum 65536 (MAX_WORLD_CAPACITY).
 * const world = new World({
 *   capacity: 1024,
 *   components: [positionComponent], // at least one component required
 * });
 * world.init(); // runs System init hooks
 * world.refresh(); // once per frame (or use world.frame)
 * world.destroy(); // destroys entities/components; runs System destroy hooks
 * ```
 *
 * @example Create and destroy Entities
 * ```ts
 * const entity1: Entity | undefined = world.entities.create();
 * const entity2: Entity | undefined = world.entities.create();
 * const entity3: Entity = world.entities.createOrThrow(); // throws CapacityError when full
 * const entity4: Entity | undefined = world.entities.createWith([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * const entity5: Entity = world.entities.createWithOrThrow([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * world.entities.destroy(entity2);
 * world.entities.isActive(entity1); // true
 * world.entities.isActive(entity2); // false (destroyed)
 * ```
 *
 * @example Add and remove Components
 * ```ts
 * world.components.addToEntity(positionComponent, entity1);
 * world.components.addToEntity(positionComponent, entity2, { x: 10, y: 20 });
 * // upsert: ownership unchanged; provided fields merge
 * world.components.addToEntity(positionComponent, entity2, { x: 15 }); // y stays 20
 * world.components.addBundle(entity2, [
 *   [positionComponent, { x: 10, y: 20 }],
 *   [facingComponent, { dir: 0 }],
 * ]);
 * world.components.removeFromEntity(positionComponent, entity2);
 * ```
 *
 * @example Read and write Component data
 * ```ts
 * import { entityIndex } from "@phughesmcr/miski";
 *
 * // Guarded public APIs (throw on inactive / non-owner / tag / unregistered):
 * const data = world.components.getEntityData(positionComponent, entity1);
 * world.components.setEntityData(positionComponent, entity1, { x: 10, y: 20 });
 * world.components.setEntityData(positionComponent, entity1, { x: 15 }); // partial; y kept
 *
 * // Soft reads (undefined for inactive / non-owner / tag; only unregistered throws):
 * const soft = world.components.readEntityData(positionComponent, entity1);
 * const out = { x: 0, y: 0 };
 * world.components.readEntityDataInto(positionComponent, entity1, out);
 *
 * // Proxy: type-safe writes with change tracking
 * const positionInstance = world.components.getInstance(positionComponent);
 * if (positionInstance) {
 *   positionInstance.proxy.entity = entity1;
 *   positionInstance.proxy.x = 10;
 *   positionInstance.proxy.y = 20;
 * }
 *
 * // Direct SoA: index by slot (entityIndex), not the packed handle.
 * // Prefer .storage.partitions (.partitions is an alias). No automatic change tracking.
 * const required = world.components.require(positionComponent);
 * required.storage!.partitions.x[entityIndex(entity1)] = 10;
 * required.storage!.partitions.y[entityIndex(entity1)] = 20;
 * required.markChanged(entity1);
 * ```
 *
 * @example Changed tracking and snapshots
 * ```ts
 * // Borrowed dense iterator - valid until next mutation / refresh:
 * for (const entity of world.components.getChanged(positionComponent)) {
 *   console.log(entity);
 * }
 * // Stable array for tools / tests:
 * const changedSnapshot = world.components.getChangedSnapshot(positionComponent);
 * ```
 *
 * ## Hot-path
 *
 * @example Dense queryList and frame lifecycle
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * world.frame(() => {
 *   const view = world.entities.queryList(positionQuery);
 *   for (let i = 0; i < view.count; i++) {
 *     const entity = view.entities[i]!; // packed handle (identity / isActive)
 *     const slot = view.indices[i]!; // storage slot for .storage.partitions
 *     console.log(entity, slot);
 *   }
 * });
 * // refresh() has already run after the callback
 * ```
 *
 * @example Convenience entity iterator (cold path)
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * for (const entity of world.entities.query(positionQuery)) {
 *   console.log(entity);
 * }
 * ```
 *
 * @example Query filters (all / any / none / include)
 * ```ts
 * // all = AND, any = OR, none = NOT; include exposes instances without filtering membership.
 * const renderablePlayerQuery = new Query({
 *   all: [playerComponent],
 *   any: [renderableComponent, renderableSFXComponent],
 *   none: [invisibilityComponent],
 *   include: [facingComponent],
 * });
 * ```
 *
 * @example Register a typed System
 * ```ts
 * const positionSystem = new System({
 *   name: "positionSystem",
 *   query: new Query({ all: { position: positionComponent }, include: { facing: facingComponent } }),
 *   init: (world: World) => {
 *     console.log("positionSystem initialized");
 *   },
 *   destroy: (world: World) => {
 *     console.log("positionSystem destroyed");
 *   },
 *   callback: (components, entities, frametime: number, message: string): void => {
 *     const position = components.position;
 *     const facing = components.facing;
 *     const positionX = position.storage!.partitions.x;
 *     for (let i = 0; i < entities.count; i++) {
 *       const entity = entities.entities[i]!;
 *       const slot = entities.indices[i]!;
 *       position.proxy.entity = entity;
 *       if (facing.has(entity)) {
 *         const dir = facing.storage!.partitions.dir[slot];
 *       }
 *       positionX[slot] += 1;
 *     }
 *   },
 * });
 *
 * const systemInstance = world.systems.create(positionSystem);
 * const update = (frametime: number) => {
 *   world.frame(() => {
 *     systemInstance(frametime, "Hello, World!");
 *   });
 *   requestAnimationFrame(update);
 * };
 * requestAnimationFrame(update);
 * ```
 *
 * ## Tooling
 *
 * @example Typed world bootstrap, schema hash, and rollback
 * ```ts
 * import {
 *   captureWorldRollbackPoint,
 *   compileComponentSchema,
 *   componentSchemaHash,
 *   createEcsWorld,
 *   restoreWorldRollbackPoint,
 * } from "@phughesmcr/miski";
 *
 * const game = createEcsWorld({
 *   capacity: 1024,
 *   components: {
 *     Position: { x: Float32Array, y: Float32Array },
 *   },
 * });
 * await game.init();
 * const entity = game.spawn({ Position: { x: 0, y: 0 } });
 * game.storage.Position.get(entity, "x");
 *
 * const hash = componentSchemaHash({ Position: { x: Float32Array, y: Float32Array } });
 * const schema = compileComponentSchema({ Position: { x: Float32Array, y: Float32Array } });
 *
 * const point = captureWorldRollbackPoint(world);
 * // mutate...
 * restoreWorldRollbackPoint(world, point);
 * ```
 */

// --- Core ---
export { Component, isValidComponentSpec } from "@/component/component.ts";
export {
  AlreadyRegisteredError,
  CapacityError,
  ComponentDataError,
  ComponentOwnershipError,
  EntityNotFoundError,
  isMiskiError,
  MiskiError,
  NoComponentsFoundError,
  NotRegisteredError,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
export { isValidQuerySpec, Query } from "@/query/query.ts";
export { isValidSystemSpec, System } from "@/system/system.ts";
export {
  captureWorldRollbackPoint,
  commitWorldRollbackPoint,
  restoreWorldRollbackPoint,
  World,
} from "@/world/world.ts";
export { isValidWorldSpec } from "@/world/utils.ts";
export { isValidName } from "@/utils.ts";
export { asSlotIndex, entityGeneration, entityIndex, MAX_WORLD_CAPACITY, packEntity } from "@/entity/entity.ts";

// --- Tooling ---
export { canonicalizeStoredValue } from "@/value/canonicalize.ts";
export { compileComponentSchema, componentSchemaHash, mergeComponentSchemas } from "@/schema/schema.ts";
export { createEcsWorld, createEcsWorldFromSchema, createEcsWorldWithSchema, EcsWorld } from "@/world/ecs-world.ts";

export type {
  ComposedQueryComponents,
  NormalizedQueryComponentEntry,
  QueryComponents,
  QueryConstructor,
  QueryInputSpec,
} from "@/query/query.ts";
export type { SchemaPropertyArray } from "@/types.ts";
export type { ComponentInstance } from "@/component/component-instance.ts";
export type { StorageProxy } from "@/component/storage-proxy.ts";
export type {
  BorrowedEntityIndices,
  BorrowedEntityIterator,
  BorrowedEntityList,
  BorrowedSlotIndices,
  CheckpointEntitySet,
  CompiledComponentEntry,
  CompiledComponentProperty,
  CompiledComponentSchema,
  ComponentBundle,
  ComponentBundleEntryFor,
  ComponentBundleEntryInput,
  ComponentCheckpoint,
  ComponentData,
  ComponentInstances,
  ComponentMap,
  ComponentPartitions,
  ComponentRecord,
  ComponentsFromSchemaMap,
  ComponentSpec,
  ComponentValue,
  DynamicComponent,
  DynamicComponentInstance,
  EcsWorldConfig,
  Entity,
  ParametersExceptFirstTwo,
  Partition,
  PartitionStorage,
  QueryEntityList,
  QuerySpec,
  Schema,
  SchemaComponentMap,
  SchemaOrNull,
  SchemaValues,
  SlotIndex,
  SpawnSpec,
  StorageFromMap,
  StorageProxyWithProperties,
  SystemCallback,
  SystemFunction,
  SystemInstance,
  SystemRecord,
  SystemSpec,
  TypedArray,
  TypedArrayConstructor,
  TypedQuerySpec,
  TypedSystemCallback,
  UntypedQueryComponents,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldContext,
  WorldEntityAPI,
  WorldRollbackPoint,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types.ts";
