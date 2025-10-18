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
 * const entity3: Entity | undefined = world.entities.create(); // 2
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
 * @example
 *
 * @example Add a component to an Entity
 * ```ts
 * // Without setting initial values:
 * world.components.addToEntity(positionComponent, entity1);
 *
 * // With setting initial values:
 * world.components.addToEntity(positionComponent, entity2, { x: 10, y: 20 });
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
 *
 * // Second way: type-unsafe and does not show the entity in changed tracking
 * const positionComponentInstance: ComponentInstance<Vec2> = world.components.getInstance("position");
 * positionComponentInstance.storage.partitions.x[entity1] = 10;
 * positionComponentInstance.storage.partitions.y[entity1] = 20;
 *
 * // Third way: Through the component proxy - type-safe and shows the entity in changed tracking
 * const positionComponentInstance: ComponentInstance<Vec2> = world.components.getInstance("position");
 * positionComponentInstance.proxy.entity = entity1;
 * positionComponentInstance.proxy.x = 10;
 * positionComponentInstance.proxy.y = 20;
 * ```
 *
 * @example Get all the Entities whose properties changed since the last `world.refresh()`
 * ```ts
 * const changedPosition: IterableIterator<Entity> | undefined = world.components.getChanged(positionComponent);
 * if (changedPosition) {
 *   for (const entity of changedPosition) {
 *     console.log(entity);
 *   }
 * }
 * ```
 *
 * @example Query entities by component
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * const positionView: IterableIterator<Entity> = world.entities.query(positionQuery);
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
 * });
 * ```
 *
 * @example Register a System
 * ```ts
 * const positionSystem = new System({
 *   name: "positionSystem",
 *   query: positionQuery,
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
 *   callback: (components: Readonly<Record<string, ComponentInstance<any>>>, entities: IterableIterator<Entity>, ...args: any[]): void => {
 *     console.log(args[0], args[1]); // should log the frametime and "Hello, World!" (see below)
 *     for (const entity of entities) {
 *       console.log(entity);
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

export { Component, isValidComponentSpec } from "@/component/Component.ts";
export { EntityNotFoundError, isMiskiError, MiskiError, SpecError, WorldStateError } from "@/errors.ts";
export { isValidQuerySpec, Query } from "@/query/Query.ts";
export { isValidSystemSpec, System } from "@/system/System.ts";
export { World } from "@/world/World.ts";
export { isValidWorldSpec } from "@/world/utils.ts";
export { isValidName } from "@/utils.ts";
export type { ComponentInstance } from "@/component/ComponentInstance.ts";
export type { ComponentRecord, ComponentSpec, Entity, QuerySpec, Schema, SystemSpec, WorldState } from "@/types.ts";
