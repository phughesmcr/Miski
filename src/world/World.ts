/**
 * @module      World
 * @description The World is the central context in which all Entities and Components exist.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 *
 * @example Create a new World
 * ```ts
 * const world = new World({
 *   capacity: 1024,      // The maximum number of entities that the world can hold.
 *   components: [ ... ], // The components to register in the world.
 * });
 * ```
 *
 * @example Create a new Entity
 * ```ts
 * const entity1 = world.createEntity();
 * const entity2 = world.createEntity();
 * ```
 *
 * @example Add a component to an Entity
 * ```ts
 * // Without setting initial values:
 * world.entities.addComponent(entity1, positionComponent);
 *
 * // With setting initial values:
 * world.entities.addComponent(entity1, positionComponent, { x: 10, y: 20 });
 * ```
 *
 * @example Remove a component from an Entity
 * ```ts
 * world.entities.removeComponent(entity1, positionComponent);
 * ```
 *
 * @example Query entities by component
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * const entities: IterableIterator<Entity> = world.entities.query(positionQuery);
 * ```
 */

export class World {}
