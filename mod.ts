/**
 * @module      Miski
 * @description A sweet ECS library for TypeScript.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 *
 * Public surface tiers:
 * - **Core** - World, Component, Query, System, entity handles, errors
 * - **Hot-path** - dense `queryList`, direct `.storage.partitions` writes, `frame`
 * - **Tooling** - `createEcsWorld`, schema hash, checkpoints, rollback, world saves, canonicalize
 *
 * Prefer `.storage.partitions` for SoA access (`.partitions` is an alias).
 * House rule: `slots` for storage / partitions; `entities` for identity
 * (`destroy`, `isActive`, attach). Index typed arrays via `entityIndex(entity)`
 * or `queryList` `slots` - never with a packed handle. Brands catch swaps at
 * function APIs; raw `TypedArray` indexing still accepts either number.
 *
 * Every example below is self-contained and type-checked in CI
 * (`deno check --doc mod.ts`).
 *
 * ## Core
 *
 * @example Create Components
 * ```ts
 * // Schema uses typed-array constructors (storage shape). Name it without
 * // hand-writing Float32ArrayConstructor:
 * const vec2 = defineComponentSchema({ x: Float32Array, y: Float32Array });
 * type Vec2 = ComponentSchema<typeof vec2>;
 * const positionComponent = new Component({
 *   name: "position",
 *   schema: vec2,
 * });
 * const storageShape: Vec2 = vec2;
 * console.log(positionComponent.name, storageShape);
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
 * console.log(facingComponent.name);
 * ```
 *
 * @example Create, initialize, refresh, and destroy a World
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * // capacity: minimum 8, maximum 65536 (MAX_WORLD_CAPACITY).
 * const world = new World({
 *   capacity: 1024,
 *   components: [positionComponent], // at least one component required
 * });
 * await world.init(); // waits for System init hooks
 * world.refresh(); // once per frame (or use world.frame)
 * await world.destroy(); // runs all System destroy hooks; closes the system lifecycle
 * ```
 *
 * @example Create and destroy Entities
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 *
 * // create() / createWith() return undefined when the world is full.
 * const entity1: Entity | undefined = world.entities.create();
 * const entity2: Entity | undefined = world.entities.create();
 * const entity3: Entity = world.entities.createOrThrow(); // throws CapacityError when full
 * const entity4: Entity | undefined = world.entities.createWith([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * const entity5: Entity = world.entities.createWithOrThrow([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * if (entity1 === undefined || entity2 === undefined) throw new Error("world is full");
 * world.entities.destroy(entity2);
 * world.entities.isActive(entity1); // true
 * world.entities.isActive(entity2); // false (destroyed)
 * console.log(entity3, entity4, entity5);
 * ```
 *
 * @example Add and remove Components
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const facingComponent = new Component({ name: "facing", schema: { dir: Uint8Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent, facingComponent] });
 * const entity1 = world.entities.createOrThrow();
 * const entity2 = world.entities.createOrThrow();
 *
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
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 * const entity1 = world.entities.createWithOrThrow([[positionComponent, { x: 1, y: 2 }]]);
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
 * console.log(data, soft, out);
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
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 *
 * // Borrowed dense iterator - valid until next mutation / refresh.
 * // Both calls return undefined when the component is not registered with the world.
 * for (const entity of world.components.getChanged(positionComponent) ?? []) {
 *   console.log(entity);
 * }
 * // Stable array for tools / tests:
 * const changedSnapshot = world.components.getChangedSnapshot(positionComponent) ?? [];
 * console.log(changedSnapshot.length);
 * ```
 *
 * ## Hot-path
 *
 * @example Dense queryList and frame lifecycle
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 * const positionQuery = new Query({ all: [positionComponent] });
 * world.frame(() => {
 *   const view = world.entities.queryList(positionQuery);
 *   for (let i = 0; i < view.count; i++) {
 *     const entity = view.entities[i]!; // packed handle (identity / isActive)
 *     const slot = view.slots[i]!; // storage slot for .storage.partitions
 *     console.log(entity, slot);
 *   }
 * });
 * // refresh() has already run after the callback
 * ```
 *
 * @example Convenience entity iterator (cold path)
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 * const positionQuery = new Query({ all: [positionComponent] });
 * for (const entity of world.entities.query(positionQuery)) {
 *   console.log(entity);
 * }
 * ```
 *
 * @example Query filters (all / any / none / include)
 * ```ts
 * const tag = (name: string) => new Component({ name });
 * const playerComponent = tag("player");
 * const renderableComponent = tag("renderable");
 * const renderableSFXComponent = tag("renderableSFX");
 * const invisibilityComponent = tag("invisibility");
 * const facingComponent = new Component({ name: "facing", schema: { dir: Uint8Array } });
 *
 * // all = AND, any = OR, none = NOT; include exposes instances without filtering membership.
 * const renderablePlayerQuery = new Query({
 *   all: [playerComponent],
 *   any: [renderableComponent, renderableSFXComponent],
 *   none: [invisibilityComponent],
 *   include: [facingComponent],
 * });
 * console.log(renderablePlayerQuery);
 * ```
 *
 * @example Register a typed System
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const facingComponent = new Component({ name: "facing", schema: { dir: Uint8Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent, facingComponent] });
 *
 * const positionSystem = new System({
 *   name: "positionSystem",
 *   query: new Query({ all: { position: positionComponent }, include: { facing: facingComponent } }),
 *   init: (_world: WorldContext) => {
 *     console.log("positionSystem initialized");
 *   },
 *   destroy: (_world: WorldContext) => {
 *     console.log("positionSystem destroyed");
 *   },
 *   // Parameters after (components, entities) are inferred as the system's call arguments.
 *   callback: (components, entities, frametime: number, message: string): void => {
 *     const position = components.position;
 *     const facing = components.facing;
 *     const positionX = position.storage!.partitions.x;
 *     for (let i = 0; i < entities.count; i++) {
 *       const entity = entities.entities[i]!;
 *       const slot = entities.slots[i]!;
 *       position.proxy.entity = entity;
 *       if (facing.has(entity)) {
 *         const dir = facing.storage!.partitions.dir[slot];
 *         console.log(message, dir);
 *       }
 *       positionX[slot]! += frametime;
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
 *   tags: {
 *     Player: true,
 *   },
 * });
 * await game.init();
 * const entity = game.spawn({ Position: { x: 0, y: 0 }, Player: true });
 * game.storage.Position.get(entity, "x");
 *
 * const hash = componentSchemaHash(
 *   { Position: { x: Float32Array, y: Float32Array } },
 *   { Player: true },
 * );
 * const schema = compileComponentSchema(
 *   { Position: { x: Float32Array, y: Float32Array } },
 *   { Player: true },
 * );
 * console.log(hash, schema);
 *
 * // Rollback points are captured from (and restored to) the underlying World.
 * const point = captureWorldRollbackPoint(game.world);
 * // mutate...
 * restoreWorldRollbackPoint(game.world, point);
 * ```
 *
 * @example World saves, JSON documents and deltas
 * ```ts
 * import {
 *   applyWorldDelta,
 *   Component,
 *   createWorldDelta,
 *   loadWorld,
 *   saveWorld,
 *   World,
 *   worldSaveFromJSON,
 *   worldSaveToJSON,
 * } from "@phughesmcr/miski";
 *
 * const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 256, components: [position] });
 * await world.init();
 * const entity = world.entities.createOrThrow();
 * world.components.addToEntity(position, entity, { x: 1, y: 2 });
 *
 * // A save holds entities, generations, ownership, values, archetype order and the open window.
 * const base = saveWorld(world);
 * world.components.setEntityData(position, entity, { x: 5, y: 6 });
 * const next = saveWorld(world);
 *
 * // A delta rebuilds `next` from `base` byte for byte.
 * const delta = createWorldDelta(base, next);
 * loadWorld(world, applyWorldDelta(base, delta));
 *
 * // A lossless JSON view of the same save.
 * const text = JSON.stringify(worldSaveToJSON(next));
 * loadWorld(world, worldSaveFromJSON(JSON.parse(text)));
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
export {
  asEntity,
  asSlotIndex,
  entityGeneration,
  entityIndex,
  MAX_WORLD_CAPACITY,
  packEntity,
} from "@/entity/entity.ts";

// --- Tooling ---
export { canonicalizeStoredValue } from "@/value/canonicalize.ts";
export {
  compileComponentSchema,
  componentSchemaHash,
  defineComponentSchema,
  mergeComponentSchemas,
} from "@/schema/schema.ts";
export { createEcsWorld, createEcsWorldFromSchema, createEcsWorldWithSchema, EcsWorld } from "@/world/ecs-world.ts";
export {
  describeWorldSaveLayout,
  loadWorld,
  measureWorldSave,
  readWorldSaveHeader,
  saveWorld,
  saveWorldInto,
} from "@/serialization/world-save.ts";
export { worldSaveFromJSON, worldSaveToJSON } from "@/serialization/document.ts";
export { applyWorldDelta, createWorldDelta } from "@/serialization/delta.ts";
export { WorldSaveError } from "@/serialization/format.ts";
export type { WorldSaveHeader, WorldSaveLoadOptions } from "@/serialization/world-save.ts";
export type { WorldSaveComponentDocument, WorldSaveDocument, WorldSaveNumber } from "@/serialization/document.ts";
export type { WorldSaveComponentLayout, WorldSaveField, WorldSaveLayout } from "@/serialization/layout.ts";
export type { WorldSaveFieldType } from "@/serialization/format.ts";

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
  BorrowedEntityListEachFn,
  BorrowedSlotIndices,
  CheckpointEntitySet,
  CompiledComponentEntry,
  CompiledComponentProperty,
  CompiledComponentSchema,
  ComponentBundle,
  ComponentBundleEntryFor,
  ComponentBundleEntryInput,
  ComponentCheckpoint,
  ComponentConstructor,
  ComponentData,
  ComponentInstances,
  ComponentMap,
  ComponentPartitions,
  ComponentRecord,
  ComponentSchema,
  ComponentsFromSchemaMap,
  ComponentSpec,
  ComponentValue,
  DataStorageFromMap,
  DynamicComponent,
  DynamicComponentInstance,
  EcsWorldConfig,
  Entity,
  InferredDataComponentSpec,
  ParametersExceptFirstTwo,
  Partition,
  PartitionStorage,
  QueryEntityList,
  QuerySpec,
  RegistryFromMaps,
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
  TagComponentSpec,
  TagMap,
  TagsFromMap,
  TagSpec,
  TagStorageFromMap,
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
