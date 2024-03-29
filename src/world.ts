/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ArchetypeManager } from "./archetype/manager.js";
import { ComponentManager, removeEntity } from "./component/manager.js";
import { $_OWNERS, VERSION } from "./constants.js";
import { QueryManager } from "./query/manager.js";
import { Query } from "./query/query.js";
import { BitPool } from "./utils/bitpool.js";
import { isObject, isPositiveInt, isUint32, Opaque } from "./utils/utils.js";
import type { Component } from "./component/component.js";
import type { ComponentInstance } from "./component/instance.js";
import type { ComponentRecord } from "./component/manager.js";
import type { Schema, SchemaProps } from "./component/schema.js";

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
export type Entity = Opaque<number, "Entity">;

/** The object returned from `world.save();` */
export interface WorldData {
  /** The world's component storage buffer */
  buffer: ArrayBuffer;
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** The Miski version of the creating world */
  version: string;
}

export interface WorldSpec {
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** Components to instantiate in the world */
  components: Component<any>[];
}

/**
 * Creates a valid WorldSpec (if possible) from an object
 * @param spec The object to examine
 * @returns A new WorldSpec object
 * @throws On invalid WorldSpec properties
 */
function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  // check spec exists
  if (!spec || !isObject(spec)) {
    throw new SyntaxError("World creation requires a specification object.");
  }
  const { capacity, components } = spec;
  // check capacity
  if (!isPositiveInt(capacity)) {
    throw new SyntaxError("World: spec.capacity invalid.");
  }
  // check components
  if (!Array.isArray(components) || !components.every((c) => Object.prototype.hasOwnProperty.call(c, "name"))) {
    throw new TypeError("World: spec.components invalid.");
  }
  return { ...spec, components: [...new Set(components)] };
}

export class World {
  private readonly archetypeManager: ArchetypeManager;
  private readonly componentManager: ComponentManager;
  private readonly queryManager: QueryManager;

  /** Pool of Entity states */
  private readonly entities: BitPool;

  /** The maximum number of entities the world can hold */
  readonly capacity: number;

  /** Miski version */
  readonly version = VERSION;

  /**
   * Create a new World object
   * @param spec An WorldSpec object
   * @param spec.capacity The maximum number of entities allowed in the world
   * @param spec.components An array of components to instantiate in the world
   * @throws If the spec is invalid
   */
  constructor(spec: WorldSpec) {
    const { capacity, components } = validateWorldSpec(spec);
    this.capacity = capacity;
    this.entities = new BitPool(capacity);
    this.archetypeManager = new ArchetypeManager({ capacity, components });
    this.componentManager = new ComponentManager({ capacity, components });
    this.queryManager = new QueryManager({ componentManager: this.componentManager });
    this.refresh();
    Object.freeze(this);
  }

  /** @returns the number of active entities */
  get residents(): number {
    return this.capacity - (this.entities.setCount - (this.entities.size - this.capacity));
  }

  /** @returns the number of available entities */
  get vacancies(): number {
    return this.capacity - this.residents;
  }

  /**
   * Creates a function to add a given set of components to an entity
   * @param components One or more components to add
   * @returns A function which takes an entity and optional properties object
   * @throws if one or more components are not registered in this world
   */
  addComponentsToEntity(...components: Component<any>[]) {
    const cb = this.componentManager.addComponentsToEntity(components);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (entity: Entity, properties?: Record<string, SchemaProps<unknown>>): World => {
      if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      this.archetypeManager.updateArchetype(entity, cb(entity, properties));
      return self;
    };
  }

  /** @returns the next available Entity or `undefined` if no Entity is available */
  createEntity(): Entity | undefined {
    if (this.residents >= this.capacity) return;
    const entity = this.entities.acquire() as Entity;
    if (entity < 0) return;
    this.archetypeManager.setArchetype(entity, this.archetypeManager.rootArchetype);
    return entity;
  }

  /**
   * Remove and recycle an Entity
   * @param entity the entity to destroy
   * @returns the world
   * @throws if the entity is invalid
   */
  destroyEntity(entity: Entity): World {
    if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
    // eslint-disable-next-line array-callback-return
    this.archetypeManager.entityArchetypes[entity]?.components.forEach((instance) => removeEntity(instance, entity));
    this.archetypeManager.resetArchetype(entity);
    this.entities.release(entity);
    return this;
  }

  /**
   * Get all the changed entities from a set of components
   * @param components The components to collect changed entities from
   * @returns An array of entities
   * @throws if one or more components are not registered in this world
   */
  getChangedFromComponents(...components: Component<any>[]): Entity[] {
    const instances = this.componentManager.getInstances(components).filter((x) => x);
    if (instances.length !== components.length) throw new Error("Not all components registered!");
    return [
      ...new Set(
        instances.reduce((res, inst) => {
          res.push(...inst!.changed);
          return res;
        }, [] as Entity[]),
      ),
    ];
  }

  /**
   * Get all the changed entities from a query
   * @param query the query to collect changed entities from
   * @param arr an optional array to be emptied and recycled
   * @returns an array of entities
   * @throws if query is invalid
   */
  getChangedFromQuery(query: Query, arr: Entity[] = []): Entity[] {
    const instance = this.queryManager.getQueryInstance(query);
    arr.length = 0;
    // eslint-disable-next-line array-callback-return
    Object.values(instance.components).forEach((inst) => arr.push(...inst.changed));
    return [...new Set(arr)];
  }

  /**
   * Get this world's instance of a component
   * @param component The component to retrieve the instance of
   * @returns The component instance or undefined if the component is not registered
   */
  getComponentInstance<T extends Schema<T>>(component: Component<T>): ComponentInstance<T> | undefined {
    return this.componentManager.componentMap.get(component);
  }

  /**
   * Get this world's instances of a set of components
   * @param component The component to retrieve the instance of
   * @returns An array of component instances or undefined if the component is not registered
   */
  getComponentInstances(...components: Component<any>[]): (ComponentInstance<any> | undefined)[] {
    return this.componentManager.getInstances(components);
  }

  /**
   * Get all of the component properties of a given entity
   * @param entity The entity to retrieve the properties of
   * @returns An object where keys are component names and properties are the entity's properties
   */
  getEntityProperties(entity: Entity): Record<string, SchemaProps<unknown>> {
    const archetype = this.archetypeManager.getArchetype(entity);
    if (!archetype) return {};
    return archetype.components.reduce(
      <T extends Schema<T>>(res: Record<keyof T, SchemaProps<unknown>>, component: ComponentInstance<T>) => {
        const { name, schema } = component;
        res[name as keyof T] = {};
        if (schema === null) {
          res[name as keyof T] = true;
        } else {
          res[name as keyof T] = Object.keys(schema).reduce((prev, key) => {
            prev[key as keyof T] = component[key as keyof T][entity];
            return prev;
          }, {} as SchemaProps<T>);
        }
        return res;
      },
      {},
    );
  }

  /**
   * Get all the components positively associated with a query
   * @param query The query to get the components from
   * @returns An object where keys are component names and properties are component instances
   * @throws If the query is invalid
   */
  getQueryComponents(query: Query): ComponentRecord {
    return this.queryManager.getComponentsFromQuery(query);
  }

  /**
   * Get all the entities which have entered the query since the last refresh
   * @param query The query to get the entities from
   * @param arr An optional array to be emptied and recycled
   * @returns An array of entities
   * @throws If the query is invalid
   */
  getQueryEntered(query: Query, arr: Entity[] = []): Entity[] {
    return this.queryManager.getEnteredFromQuery(query, arr);
  }

  /**
   * Get all the entities which match a query
   * @param query The query to get the entities from
   * @param arr An optional array to be emptied and recycled
   * @returns An array of entities
   * @throws If the query is invalid
   */
  getQueryEntities(query: Query, arr: Entity[] = []): Entity[] {
    return this.queryManager.getEntitiesFromQuery(query, arr);
  }

  /**
   * Get all the entities which have exited the query since the last refresh
   * @param query The query to get the entities from
   * @param arr An optional array to be emptied and recycled
   * @returns An array of entities
   * @throws If the query is invalid
   */
  getQueryExited(query: Query, arr: Entity[] = []): Entity[] {
    return this.queryManager.getExitedFromQuery(query, arr);
  }

  /**
   * Create a function to test entities for a given component
   * @param component The component to test for
   * @returns A function which takes an entity and returns
   *     true if the entity has the component, false if it does not
   *     or null if the entity does not exist.
   * @throws if the component is not registered in this world
   */
  hasComponent<T extends Schema<T>>(component: Component<T>): (entity: Entity) => boolean | null {
    const instance = this.componentManager.getInstance(component);
    if (!instance) throw new Error("Component is not registered.");
    return (entity: Entity) => instance[$_OWNERS].isSet(entity);
  }

  /**
   * Create a function to test entities for a given component
   * @param components The components to test for
   * @returns A function which takes an entity and returns an array of
   *     true if the entity has the component, false if it does not
   *     or null if the entity does not exist.
   * @throws if one or more component is not registered in this world
   */
  hasComponents(...components: Component<any>[]): (entity: Entity) => (boolean | null)[] {
    const instances = this.componentManager.getInstances(components).filter((x) => x) as ComponentInstance<any>[];
    if (instances.length !== components.length) throw new Error("Not all components registered!");
    return (entity: Entity): (boolean | null)[] => {
      return instances.map((component) => component[$_OWNERS].isSet(entity));
    };
  }

  /**
   * Test if an entity is active in the world
   * @return a boolean or null if the entity is invalid
   *
   */
  isEntityActive(entity: Entity): boolean | null {
    if (!this.isValidEntity(entity)) return null;
    return this.entities.isSet(entity);
  }

  /** @return `true` if the given entity is valid for the given capacity */
  isValidEntity(entity: Entity): entity is Entity {
    return isUint32(entity) && entity < this.entities.size;
  }

  /**
   * Swap the ComponentBuffer of one world with this world
   * @returns the world
   * @throws if the capacity or version of the data to load is mismatched
   */
  load(data: WorldData): World {
    const { buffer, capacity, version } = data;
    if (version !== this.version) {
      throw new Error(`Version mismatch. Trying to load ${version} data into ${this.version} world.`);
    }
    if (capacity !== this.capacity) {
      throw new Error(`Capacity mismatch. Data requires a world with a capacity of ${capacity}.`);
    }
    this.componentManager.setBuffer(buffer);
    this.refresh();
    return this;
  }

  /** Runs various world maintenance functions */
  refresh(): World {
    this.queryManager.refreshQueries();
    this.archetypeManager.refreshArchetypes(this.queryManager.queryMap);
    this.componentManager.refreshComponents();
    return this;
  }

  /**
   * Creates a function to remove a given set of components from an entity
   * @param components One or more components to remove
   * @returns A function which takes an entity
   * @throws if one or more components are not registered in this world
   */
  removeComponentsFromEntity(...components: Component<any>[]): (entity: Entity) => World {
    const remover = this.componentManager.removeComponentsFromEntity(components);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (entity: Entity) => {
      if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      this.archetypeManager.updateArchetype(entity, remover(entity));
      return self;
    };
  }

  /** Export various bits of data about the world */
  save(): WorldData {
    return Object.freeze({
      buffer: this.componentManager.getBuffer(),
      capacity: this.capacity,
      version: this.version,
    });
  }
}
