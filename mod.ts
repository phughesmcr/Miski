/**
 * @module      Miski
 * @description A sweet ECS library for TypeScript.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 *
 * @example Create Components
 * ```ts
 * type Vec2 = { x: number; y: number };
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
 * type FacingValue = { dir: 0 | 1 | 2 | 3 };
 * type FacingStorage = { dir: Uint8ArrayConstructor };
 * const facingComponent = new Component<FacingValue, FacingStorage>({
 *   name: "facing",
 *   schema: { dir: Uint8Array },
 * });
 * ```
 *
 * @example Create a new World
 * ```ts
 * // Create a new World with a capacity of 1024 entities and register the component.
 * const world = new World({
 *   capacity: 1024,      // The maximum number of entities that the world can hold.
 *   components: [ positionComponent ], // The components to register in the world (requires at least one component).
 * });
 * ```
 *
 * @example Destroy a World
 * ```ts
 * // Destroying a World will destroy all Entities and Components within it.
 * // Also calls all System's `destroy` methods.
 * world.destroy();
 * ```
 *
 * @example Initialize a World
 * ```ts
 * // Calls all System's `init` methods.
 * world.init();
 * ```
 *
 * @example Run routine maintenance on the world
 * ```ts
 * // Recommended once per frame (minimum).
 * world.refresh();
 * ```
 *
 * @example Create a new Entity
 * ```ts
 * const entity1: Entity | undefined = world.entities.create(); // 0
 * const entity2: Entity | undefined = world.entities.create(); // 1
 * // Or, if capacity exhaustion should be an error rather than a soft failure:
 * const entity3: Entity = world.entities.createOrThrow(); // 2 (throws CapacityError when full)
 * const entity4: Entity | undefined = world.entities.createWith([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * const entity5: Entity = world.entities.createWithOrThrow([
 *   [positionComponent, { x: 1, y: 2 }],
 * ]);
 * // To create multiple entities, call create() in a loop
 * const entities: Entity[] = [];
 * for (let i = 0; i < 7; i++) {
 *   const entity = world.entities.create();
 *   if (entity !== undefined) entities.push(entity);
 * }
 * ```
 *
 * @example Destroy an Entity
 * ```ts
 * world.entities.destroy(entity2);
 * ```
 *
 * @example Check if an Entity is active
 * ```ts
 * const isActive: boolean = world.entities.isActive(entity1); // true
 * const isActive2: boolean = world.entities.isActive(entity2); // false (destroyed)
 * ```
 *
 * @example Add a component to an Entity
 * ```ts
 * // Without setting initial values:
 * world.components.addToEntity(positionComponent, entity1);
 *
 * // With setting initial values:
 * world.components.addToEntity(positionComponent, entity2, { x: 10, y: 20 });
 *
 * // addToEntity is an upsert: if the entity already owns the component,
 * // ownership is unchanged and any provided data is merged.
 * world.components.addToEntity(positionComponent, entity2, { x: 15 }); // y stays 20
 *
 * // Add or upsert multiple components atomically:
 * world.components.addBundle(entity2, [
 *   [positionComponent, { x: 10, y: 20 }],
 *   [facingComponent, { dir: 0 }],
 * ]);
 * ```
 *
 * @example Remove a component from an Entity
 * ```ts
 * world.components.removeFromEntity(positionComponent, entity2);
 * ```
 *
 * @example Set an Entity's component values
 * ```ts
 * // Ideally this is done through a System.
 *
 * // First way: type-safe and shows the entity in changed tracking
 * world.components.setEntityData<Vec2>(positionComponent, entity1, { x: 10, y: 20 });
 * // Partial updates are supported; omitted keys keep their current values:
 * world.components.setEntityData<Vec2>(positionComponent, entity1, { x: 15 });
 *
 * // Second way: type-unsafe and does not show the entity in changed tracking
 * const positionComponentInstance = world.components.require("position");
 * positionComponentInstance.partitions!.x[entity1] = 10;
 * positionComponentInstance.partitions!.y[entity1] = 20;
 * positionComponentInstance.markChanged(entity1);
 *
 * // Third way: Through the component proxy - type-safe and shows the entity in changed tracking
 * const positionComponentInstance: ComponentInstance<Vec2> = world.components.getInstance("position");
 * positionComponentInstance.proxy.entity = entity1;
 * positionComponentInstance.proxy.x = 10;
 * positionComponentInstance.proxy.y = 20;
 * ```
 *
 * @example Get all the data-component Entities whose properties changed since the last `world.refresh()`
 * ```ts
 * const changedPosition: IterableIterator<Entity> | undefined = world.components.getChanged(positionComponent);
 * if (changedPosition) {
 *   for (const entity of changedPosition) {
 *     console.log(entity);
 *   }
 * }
 * ```
 *
 * @example Read a component's data without throwing
 * ```ts
 * // Returns undefined if the entity is inactive, does not own the component,
 * // or the component is a tag. Only unregistered components throw.
 * const data = world.components.readEntityData(positionComponent, entity1);
 * if (data !== undefined) {
 *   console.log(data.x, data.y);
 * }
 * const out = { x: 0, y: 0 };
 * world.components.readEntityDataInto(positionComponent, entity1, out);
 * ```
 *
 * @example Query entities by component for hot loops
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * const positionView = world.entities.queryList(positionQuery);
 * for (let i = 0; i < positionView.count; i++) {
 *   const entity = positionView.indices[i]!;
 *   console.log(entity);
 * }
 * // Or, on cold paths, borrowed lists are directly iterable:
 * for (const entity of positionView) {
 *   console.log(entity);
 * }
 * ```
 *
 * @example Query entities by component with the convenience iterator API
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * const positionView = world.entities.query(positionQuery);
 * for (const entity of positionView) {
 *   console.log(entity);
 * }
 * ```
 *
 * @example Query entities by component (complex)
 * ```ts
 * const renderablePlayerQuery = new Query({
 *   // All entities must have the player component.
 *   all: [playerComponent],
 *   // All entities must have the renderable component or the renderable SFX component.
 *   any: [renderableComponent, renderableSFXComponent],
 *   // All entities must not have the invisibility component.
 *   none: [invisibilityComponent],
 *   // Expose component instances without filtering membership.
 *   include: [facingComponent],
 * });
 * ```
 *
 * @example Register a typed System
 * ```ts
 * const positionSystem = new System({
 *   name: "positionSystem",
 *   query: new Query({ all: { position: positionComponent }, include: { facing: facingComponent } }),
 *   // optional
 *   init: (world: World) => {
 *     // called once on world.init()
 *     console.log("positionSystem initialized");
 *   },
 *   // optional
 *   destroy: (world: World) => {
 *     // called once on world.destroy()
 *     console.log("positionSystem destroyed");
 *   },
 *   // required
 *   // The callback to run when the SystemInstance is called
 *   callback: (components, entities, frametime: number, message: string): void => {
 *     console.log(frametime, message);
 *     const position = components.position;
 *     const facing = components.facing;
 *     for (let i = 0; i < entities.count; i++) {
 *       const entity = entities.indices[i]!;
 *       position.proxy.entity = entity;
 *       if (facing.has(entity)) {
 *         const dir = facing.partitions.dir[entity];
 *       }
 *     }
 *   },
 * });
 *
 * const systemInstance = world.systems.create(positionSystem);
 *
 * const update = (frametime: number) => {
 *   systemInstance(frametime, "Hello, World!"); // the System's callback is called here
 *   requestAnimationFrame(update);
 * }
 *
 * requestAnimationFrame(update);
 * ```
 */

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
export { QueryRuntime } from "@/query/query.ts";
export { isComponentMap, isValidQuerySpec, normalizeQuerySpec, Query } from "@/query/query.ts";
export { isValidSystemSpec, System } from "@/system/system.ts";
export { World } from "@/world/world.ts";
export { isValidWorldSpec } from "@/world/utils.ts";
export { isValidName } from "@/utils.ts";
export type {
  NormalizedQueryComponentEntry,
  NormalizedQuerySpec,
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
  ComponentBundle,
  ComponentBundleEntryFor,
  ComponentBundleEntryInput,
  ComponentData,
  ComponentInstances,
  ComponentMap,
  ComponentPartitions,
  ComponentRecord,
  ComponentSpec,
  ComponentValue,
  DynamicComponent,
  DynamicComponentInstance,
  Entity,
  ParametersExceptFirstTwo,
  Partition,
  PartitionStorage,
  QueryEntityList,
  QuerySpec,
  Schema,
  SchemaOrNull,
  SchemaPartitions,
  SchemaValues,
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
  WorldSpec,
  WorldState,
  WorldSystemAPI,
} from "@/types.ts";
