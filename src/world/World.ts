/**
 * @module      World
 * @description The World is the central context in which all Entities and Components exist.
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
 * const entity1: Entity = world.entities.create(); // 0
 * const entity2: Entity = world.entities.create(); // 1
 * const entity3: Entity = world.entities.create(); // 2
 * const entities4to10: Entity[] = world.entities.create(7); // [3, 4, 5, 6, 7, 8, 9]
 * ```
 *
 * @example Destroy an Entity
 * ```ts
 * const wasDestroyed: boolean = world.entities.destroy(entity2); // true
 * ```
 *
 * @example Check if an Entity exists
 * ```ts
 * const exists: boolean = world.entities.exists(entity1); // true
 * const exists2: boolean = world.entities.exists(entity2); // false
 * ```
 *
 * @example
 *
 * @example Add a component to an Entity
 * ```ts
 * // Without setting initial values:
 * world.entities.addComponent(entity1, positionComponent);
 *
 * // With setting initial values:
 * world.entities.addComponent(entity2, positionComponent, { x: 10, y: 20 });
 * ```
 *
 * @example Remove a component from an Entity
 * ```ts
 * world.entities.removeComponent(entity2, positionComponent);
 * ```
 *
 * @example Set an Entity's component values
 * ```ts
 * // Ideally this is done through a System.
 *
 * // First way: type-safe and shows the entity in `world.components.get("position").changed`
 * world.components.set<Vec2>(entity1, positionComponent, { x: 10, y: 20 });
 *
 * // Second way: type-unsafe and does not show the entity in `world.components.get("position").changed`
 * const positionComponentInstance: ComponentInstance<Vec2> = world.components.get("position");
 * positionComponentInstance.data[entity1].x = 10;
 * positionComponentInstance.data[entity1].y = 20;
 *
 * // Third way: Through the component proxy type-safe and shows the entity in `world.components.get("position").changed`
 * const positionComponentInstance: ComponentInstance<Vec2> = world.components.get("position");
 * positionComponentInstance.cursor = entity1;
 * positionComponentInstance.x = 10;
 * positionComponentInstance.y = 20;
 * ```
 *
 * @example Get an Entity's components
 * ```ts
 * const components: Set<ComponentInstance<any>> = world.components.fromEntities(entity1);
 * ```
 *
 * @example Get all the Entities whose properties changed since the last `world.refresh()`
 * ```ts
 * const changedPosition: IterableIterator<Entity> = world.components.get("position").changed;
 * ```
 *
 * @example Query entities by component
 * ```ts
 * const positionQuery = new Query({ all: [positionComponent] });
 * const positionView: IterableIterator<Entity> = world.entities.query(positionQuery);
 * for (const entity of positionView) {
 *   console.log(entity); // Should log only "0", because entity1 is the first entity created.
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
 * const system = new System({
 *   name: "positionSystem",
 *   query: positionQuery,
 *   // optional
 *   init: () => {
 *     // called once on world.init()
 *     console.log("positionSystem initialized");
 *   },
 *   // optional
 *   destroy: () => {
 *     // called once on world.destroy()
 *     console.log("positionSystem destroyed");
 *   },
 *   // required
 *   // The callback to run when the SystemInstance is created (below)
 *   callback: (entities: IterableIterator<Entity>, components: Readonly<Record<string, ComponentInstance<any>>>, ...args: any[]): void => {
 *     console.log(args[0], args[1]); // should log the frametime and "Hello, World!" (see below)
 *     for (const entity of entities) {
 *       console.log(entity);
 *     }
 *   },
 * });
 *
 * const systemInstance: Function = world.systems.create(system);
 *
 * const update = (frametime: number) => {
 *   systemInstance(frametime, "Hello, World!"); // the System's callback is called here
 *   requestAnimationFrame(update);
 * }
 *
 * requestAnimationFrame(update);
 * ```
 *
 * @example Serialize to and from JSON
 * ```ts
 * const json: string = world.stringify();
 * const world2: World = World.fromJSON(json);
 * ```
 */

import { ArchetypeManager } from "../archetype/ArchetypeManager.ts";
import { isValidComponentArray } from "../component/Component.ts";
import { ComponentManager } from "../component/ComponentManager.ts";
import { VERSION } from "../constants.ts";
import { EntityManager } from "../entity/EntityManager.ts";
import { SpecError, WorldStateError } from "../errors.ts";
import { QueryManager } from "../query/QueryManager.ts";
import { SystemManager } from "../system/SystemManager.ts";
import type { Entity, WorldComponentAPI, WorldEntityAPI, WorldSpec, WorldState, WorldSystemAPI } from "../types.ts";
import { isObject, isPositiveUint32 } from "../utils.ts";

/**
 * Test if an object is a valid WorldSpec
 * @param spec The object to test
 * @returns `true` if the object is a valid WorldSpec, `false` otherwise
 */
export function isValidWorldSpec(spec: unknown): spec is WorldSpec {
  if (isObject(spec) === false) return false;
  const { capacity, components } = spec;
  if (isPositiveUint32(capacity) === false) return false;
  if (isValidComponentArray(components) === false) return false;
  return true;
}

export class World {
  /**
   * Deserialize a World from a JSON string
   * @param json The JSON string to deserialize
   * @returns The deserialized World
   */
  static fromJSON(json: string): World {
    const spec: WorldSpec = JSON.parse(json);
    const world = new World(spec);
    // TODO: setup everything
    return world;
  }

  /** Miski library version */
  static readonly version: string = VERSION;

  /** Handles groupings of components */
  #archetypeManager: ArchetypeManager;

  /** Handles component registration and allocation */
  #componentManager: ComponentManager;

  /** Handles entity creation and destruction */
  #entityManager: EntityManager;

  /** Handles groupings of entities */
  #queryManager: QueryManager;

  /** Handles system creation and destruction */
  #systemManager: SystemManager;

  /** The World's current state */
  #state: WorldState;

  /** Entity Management API */
  readonly entities: WorldEntityAPI;

  /** Component Management API */
  readonly components: WorldComponentAPI;

  /** System Management API */
  readonly systems: WorldSystemAPI;

  constructor(spec: WorldSpec) {
    if (isValidWorldSpec(spec) === false) {
      throw new SpecError("Invalid WorldSpec");
    }

    this.#state = "uninitialized";

    const { capacity, components } = spec;
    this.#archetypeManager = new ArchetypeManager(capacity);
    this.#componentManager = new ComponentManager(capacity);
    this.#entityManager = new EntityManager(capacity);
    this.#queryManager = new QueryManager();
    this.#systemManager = new SystemManager();

    this.components = {
      count: this.#componentManager.count,
      registry: Object.create(null),
      addToEntity: this.#componentManager.addToEntity,
      entityHas: this.#componentManager.entityHas,
      fromEntity: this.#componentManager.fromEntity,
      get: this.#componentManager.get,
      getData: this.#componentManager.getData,
      isRegistered: this.#componentManager.isRegistered,
      query: this.#queryManager.components,
      removeFromEntity: this.#componentManager.removeFromEntity,
      setData: this.#componentManager.setData,
    };

    // Setup the components.byName property
    for (const component of components) {
      Object.defineProperty(this.components.registry, component.name, {
        value: this.#componentManager.get(component),
        writable: false,
        configurable: false,
      });
    }

    this.entities = {
      create: this.#entityManager.create,
      destroy: (entity: Entity) => {
        this.#entityManager.destroy(entity);
        return this;
      },
      exists: this.#entityManager.exists,
      query: this.#queryManager.entities,
    };

    this.systems = {
      create: this.#systemManager.create.bind(this.#systemManager, this),
      get: this.#systemManager.get,
      has: this.#systemManager.has,
      destroy: this.#systemManager.destroy.bind(this.#systemManager, this),
      registry: this.#systemManager.registry,
    };
  }

  /** The World's current state */
  get state(): WorldState {
    return this.#state;
  }

  /**
   * Initialize the world
   * @returns The world
   * @throws {WorldStateError} If the world is already initialized
   * @throws {WorldStateError} If the world has already been destroyed
   */
  async init(): Promise<this> {
    if (this.#state === "initialized") {
      throw new WorldStateError("World has already been initialized");
    } else if (this.#state === "destroyed") {
      throw new WorldStateError("World has already been destroyed");
    }
    // TODO: ensure everything is in its correct initial state
    this.#archetypeManager.init();
    await this.#systemManager.init(this);
    this.#state = "initialized";
    return this;
  }

  /**
   * Destroy the world
   * @returns The world
   * @throws {WorldStateError} If the world has not yet been initialized
   * @throws {WorldStateError} If the world has already been destroyed
   */
  async destroy(): Promise<this> {
    if (this.#state === "uninitialized") {
      throw new WorldStateError("World has not been initialized");
    } else if (this.#state === "destroyed") {
      throw new WorldStateError("World has already been destroyed");
    }
    // TODO: destroy everything and clearing up memory
    await this.#systemManager.destroyAll(this);
    this.#state = "destroyed";
    return this;
  }

  /**
   * Refresh the world
   * @returns The world
   * @throws {WorldStateError} If the world has not yet been initialized
   * @throws {WorldStateError} If the world has already been destroyed
   */
  refresh(): this {
    if (this.#state === "uninitialized") {
      throw new WorldStateError("World has not been initialized");
    } else if (this.#state === "destroyed") {
      throw new WorldStateError("World has already been destroyed");
    }
    return this;
  }

  stringify(): string {
    return JSON.stringify({
      version: World.version,
      state: this.#state,
      archetypes: this.#archetypeManager.stringify(),
      entities: this.#entityManager.stringify(),
      components: this.#componentManager.stringify(),
      queries: this.#queryManager.stringify(),
      systems: this.#systemManager.stringify(),
    });
  }
}
