/**
 * @module      Miski
 * @description A sweet ECS library for TypeScript.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 *
 * Public surface tiers:
 * - **Core** - World, Component, Query, System, entity handles, errors (every library failure is a `MiskiError`;
 *   test with `isMiskiError`)
 * - **Hot-path** - dense `queryList`, direct `instance.storage.partitions` writes, `frame`
 * - **Tooling** - `createEcsWorld`, schema hash, checkpoints, rollback, world saves, canonicalize
 * - **Scheduling** - `Schedule` (phases, ordering, fixed timestep), `CommandBuffer`
 *
 * Component values have three access tiers: (a) the hot path
 * `instance.storage.partitions[key][slot]`, (b) the guarded cursor `instance.proxy`
 * (or `instance.get` / `instance.set`), and (c) world-level guarded calls
 * (`components.getEntityData*`, `readEntityDataInto`, `setEntityData`).
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
 * // create() / create(bundle) return undefined when the world is full; the OrThrow forms throw.
 * // Handle 0 is a valid entity, so compare with `=== undefined`, never truthiness.
 * const entity1: Entity | undefined = world.entities.create();
 * const entity2: Entity | undefined = world.entities.create();
 * const entity3: Entity = world.entities.createOrThrow(); // throws CapacityError when full
 * const entity4: Entity | undefined = world.entities.create([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * const entity5: Entity = world.entities.createOrThrow([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * if (entity1 === undefined || entity2 === undefined) throw new Error("world is full");
 * world.entities.destroy(entity2);
 * world.entities.isActive(entity1); // true
 * world.entities.isActive(entity2); // false (destroyed)
 * world.entities.isEmpty(entity1); // true (active, no components)
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
 * @example Read and write Component data (three access tiers)
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 * const entity1 = world.entities.createOrThrow([[positionComponent, { x: 1, y: 2 }]]);
 * const position = world.components.getInstanceOrThrow(positionComponent); // getInstance() -> undefined instead
 *
 * // (a) Hot path: raw SoA columns indexed by slot (entityIndex), never the packed handle.
 * // No validation and no automatic change tracking.
 * position.storage.partitions.x[entityIndex(entity1)] = 10;
 * position.markChanged(entity1);
 *
 * // (b) Guarded cursor: ownership-checked, validated, change-tracked.
 * position.proxy.entity = entity1;
 * position.proxy.y = 20;
 * position.set(entity1, "x", 12); // one field; leaves the proxy where it was
 * const x = position.get(entity1, "x");
 *
 * // (c) World-level guarded calls. Plain names return undefined / false when absent;
 * // OrThrow names throw on inactive / non-owner / tag. Unregistered components always throw.
 * const soft = world.components.getEntityData(positionComponent, entity1); // { x, y } | undefined
 * const data = world.components.getEntityDataOrThrow(positionComponent, entity1);
 * const out = { x: 0, y: 0 };
 * world.components.readEntityDataInto(positionComponent, entity1, out); // zero-alloc; false when absent
 * world.components.setEntityData(positionComponent, entity1, { x: 10, y: 20 });
 * world.components.setEntityData(positionComponent, entity1, { x: 15 }); // partial; y kept
 * console.log(x, soft, data, out);
 * ```
 *
 * @example Changed tracking and snapshots
 * ```ts
 * const positionComponent = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const world = new World({ capacity: 1024, components: [positionComponent] });
 *
 * // Borrowed dense iterator - valid until next mutation / refresh.
 * // Both calls throw NotRegisteredError when the component is not registered with the world.
 * for (const entity of world.components.getChanged(positionComponent)) {
 *   console.log(entity);
 * }
 * // Stable array for tools / tests:
 * const changedSnapshot = world.components.getChangedSnapshot(positionComponent);
 * console.log(changedSnapshot.length);
 * ```
 *
 * ## Hot-path
 *
 * Create queries once and reuse them: a query lives as long as the world. A world registers each query the
 * first time it sees it and keeps it current on every refresh until the world is destroyed; there is no unregister.
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
 * // Each call returns its own pooled iterator over a snapshot, so nested loops over one query are safe.
 * for (const entity of world.entities.query(positionQuery)) {
 *   for (const other of world.entities.query(positionQuery)) {
 *     if (entity !== other) console.log(entity, other);
 *   }
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
 * @example Register a typed System and call it directly
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
 * // `register` runs the system's lifecycle hooks and returns its instance. A `Schedule` (below) is the usual way to
 * // run systems; calling the instance directly, as here, bypasses schedule state (enabled, runIf, ordering).
 * const systemInstance = world.systems.register(positionSystem);
 * const update = (frametime: number) => {
 *   world.frame(() => {
 *     systemInstance(frametime, "Hello, World!");
 *   });
 *   requestAnimationFrame(update);
 * };
 * requestAnimationFrame(update);
 * ```
 *
 * ## Scheduling
 *
 * @example Phases, ordering, a fixed timestep, and deferred commands
 * ```ts
 * const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
 * const expired = new Component({ name: "expired" });
 * const world = new World({ capacity: 1024, components: [position, expired] });
 * await world.init();
 *
 * const schedule = new Schedule(world, {
 *   phases: ["input", { name: "physics", fixed: true }, "render"],
 *   fixedStep: 1 / 60,
 * });
 *
 * const move = new System({
 *   name: "move",
 *   query: new Query({ all: { position } }),
 *   argCount: 1, // receives the reused ScheduleContext without allocating
 *   callback: (components, entities, ctx: ScheduleContext): void => {
 *     const x = components.position.storage.partitions.x;
 *     for (let i = 0; i < entities.count; i++) {
 *       x[entities.slots[i]!]! += ctx.dt; // ctx.dt is the fixed step here
 *       if (x[entities.slots[i]!]! > 100) ctx.commands.destroy(entities.entities[i]!);
 *     }
 *   },
 * });
 * const cull = new System({
 *   name: "cull",
 *   query: new Query({ all: [expired] }),
 *   argCount: 1,
 *   callback: (_components, entities, ctx: ScheduleContext): void => {
 *     for (let i = 0; i < entities.count; i++) ctx.commands.destroy(entities.entities[i]!);
 *   },
 * });
 *
 * schedule.add(move, { phase: "physics" });
 * schedule.add(cull, { phase: "physics", before: [move] });
 *
 * // Commands queued in a phase apply when it finishes; refresh runs once at the end.
 * schedule.run(1 / 60);
 * ```
 *
 * ## Tooling
 *
 * @example Typed world bootstrap, schema hash, and rollback
 * ```ts
 * import {
 *   compileComponentSchema,
 *   componentSchemaHash,
 *   createEcsWorld,
 *   WorldRollbackScope,
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
 * const entity = game.spawnOrThrow({ Position: { x: 0, y: 0 }, Player: true });
 * game.spawn({ Player: true }); // Entity | undefined: undefined when the world is full
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
 * console.log(hash === schema.schemaHash);
 * // A precompiled schema replaces `components` / `tags` and keeps its component identities.
 * const fromSchema = createEcsWorld({ capacity: 1024, schema });
 * console.log(fromSchema.components.Position === schema.components.Position); // true
 *
 * // A rollback scope opens on the underlying World; leaving it without commit() restores the world.
 * {
 *   using _scope = new WorldRollbackScope(game.world);
 *   game.spawn({ Position: { x: 1, y: 1 } });
 * } // the spawn is undone here
 * ```
 *
 * @example World saves and JSON documents
 * ```ts
 * import {
 *   Component,
 *   loadWorld,
 *   saveWorld,
 *   World,
 *   worldSaveFromDocument,
 *   worldSaveToDocument,
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
 * // Load replaces the world's state with the save.
 * loadWorld(world, base);
 *
 * // Reuse one buffer: the save is a view of its start, and steady-state saves allocate nothing.
 * let buffer: Uint8Array = new Uint8Array(4096);
 * const view = saveWorld(world, buffer);
 * if (view.buffer !== buffer.buffer) buffer = view; // it did not fit; keep the larger save's buffer
 *
 * // A save as a plain JSON-safe document, and back.
 * const text = JSON.stringify(worldSaveToDocument(next));
 * loadWorld(world, worldSaveFromDocument(JSON.parse(text)));
 * ```
 */

// --- Core ---
export { Component } from "@/component/component.ts";
export {
  AlreadyRegisteredError,
  ArgumentError,
  CapacityError,
  ComponentDataError,
  ComponentOwnershipError,
  EntityNotFoundError,
  isMiskiError,
  MiskiError,
  NotRegisteredError,
  RelationCycleError,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
export { Prefab } from "@/prefab/prefab.ts";
export { Query } from "@/query/query.ts";
export { isRelation, Relation } from "@/relation/relation.ts";
export type {
  DataRelationSpec,
  RelationConstructor,
  RelationDeletePolicy,
  RelationSpec,
  RelationSpecBase,
  TagRelationSpec,
} from "@/relation/relation.ts";
export type {
  AnyRelation,
  BorrowedHierarchyList,
  BorrowedRelationList,
  RelationDataInput,
  RelationInstance,
  WorldRelationAPI,
} from "@/types/world-relation-api.ts";
export { System } from "@/system/system.ts";
export { World } from "@/world/world.ts";
export { WorldRollbackScope } from "@/rollback/rollback.ts";
export {
  asEntity,
  asSlotIndex,
  entityGeneration,
  entityIndex,
  MAX_WORLD_CAPACITY,
  packEntity,
} from "@/entity/entity.ts";

// --- Tooling ---
export { compileComponentSchema, componentSchemaHash, defineComponentSchema } from "@/schema/schema.ts";
export { createEcsWorld, EcsWorld } from "@/world/ecs-world.ts";
export { cloneFieldValue, field, isFieldDescriptor } from "@/schema/field.ts";
export type {
  BoolField,
  EntityField,
  EnumField,
  FieldDescriptor,
  FieldFactory,
  FieldKind,
  FieldRaw,
  FieldValue,
  ObjectField,
  ObjectFieldEncoded,
  ObjectFieldOptions,
  StringField,
} from "@/schema/field.ts";
export type { RelationMap, RelationOptions, RelationsFromMap } from "@/world/ecs-world.ts";
export { loadWorld, readWorldSaveHeader, saveWorld, worldSaveLayout } from "@/serialization/world-save.ts";
export { worldSaveFromDocument, worldSaveToDocument } from "@/serialization/document.ts";
export { WorldSaveError } from "@/serialization/format.ts";
export type { WorldSaveHeader, WorldSaveLoadOptions } from "@/serialization/world-save.ts";
export type {
  WorldSaveComponentDocument,
  WorldSaveDocument,
  WorldSaveFieldValues,
  WorldSaveNumber,
  WorldSaveObjectValue,
  WorldSaveRelationDocument,
  WorldSaveRelationPair,
} from "@/serialization/document.ts";
export type {
  WorldSaveComponentLayout,
  WorldSaveField,
  WorldSaveLayout,
  WorldSaveRelationLayout,
} from "@/serialization/layout.ts";
export type { WorldSaveFieldType, WorldSaveNumericFieldType } from "@/serialization/format.ts";

export type {
  ComposedQueryComponents,
  QueryComponents,
  QueryConstructor,
  QueryInputSpec,
} from "@/query/query.ts";
export type { PrefabDefaults, PrefabSpec } from "@/prefab/prefab.ts";
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
  ComponentFieldSpec,
  ComponentInstances,
  ComponentMap,
  ComponentPartitions,
  ComponentRecord,
  ComponentSchema,
  ComponentsFromSchemaMap,
  ComponentSpec,
  ComponentStorage,
  ComponentValue,
  DataStorageFromMap,
  DynamicComponent,
  DynamicComponentInstance,
  EcsPrefabOptions,
  EcsWorldConfig,
  Entity,
  FieldSchema,
  InferredDataComponentSpec,
  QueryEntityList,
  QuerySpec,
  RegistryFromMaps,
  Schema,
  SchemaComponentMap,
  SchemaOrNull,
  SlotIndex,
  SpawnSpec,
  StorageFromMap,
  StorageProxyWithProperties,
  SystemArgCount,
  SystemCallback,
  SystemFunction,
  SystemHook,
  SystemHookContext,
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
  WorldComponentAPI,
  WorldContext,
  WorldEntityAPI,
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types.ts";

// --- Scheduling ---
export { CommandBuffer } from "@/scheduler/command-buffer.ts";
export type { CommandBundle, CommandBundleEntryFor, CommandData } from "@/scheduler/command-buffer.ts";
export { Schedule } from "@/scheduler/schedule.ts";
export type {
  PendingEntity,
  ScheduleClock,
  ScheduleContext,
  SchedulePhaseSpec,
  ScheduleSpec,
  ScheduleSystemOptions,
  ScheduleSystemReference,
} from "@/types/scheduler.ts";
