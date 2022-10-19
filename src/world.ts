/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ArchetypeManager } from "./archetype/manager.js";
import { ComponentManager } from "./component/manager.js";
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

export interface WorldData {
  buffer: ArrayBuffer;
  capacity: number;
  version: string;
}

export interface WorldSpec {
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** Components to instantiate in the world */
  components: Component<any>[];
}

function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  if (!spec || !isObject(spec)) {
    throw new SyntaxError("World creation requires a specification object.");
  }
  const { capacity, components } = spec;
  if (!isPositiveInt(capacity)) {
    throw new SyntaxError("World: spec.capacity invalid.");
  }
  if (
    !Array.isArray(components) ||
    !components.every((c) => Object.prototype.hasOwnProperty.call(c, "name"))
  ) {
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

  readonly version = VERSION;

  /**
   * Create a new World object
   * @param spec An WorldSpec object
   * @param spec.capacity The maximum number of entities allowed in the world
   * @param spec.components An array of components to instantiate in the world
   */
  constructor(spec: WorldSpec) {
    const { capacity, components } = validateWorldSpec(spec);
    this.entities = new BitPool(capacity);
    this.archetypeManager = new ArchetypeManager({ capacity, components });
    this.componentManager = new ComponentManager({ capacity, components });
    this.queryManager = new QueryManager({ componentManager: this.componentManager });
    this.refresh(); /** @todo is this necessary? */
    Object.freeze(this);
  }

  /** @returns the maximum number of entities the world can hold */
  get capacity(): number {
    return this.entities.size;
  }

  /** @returns the number of active entities */
  get residents(): number {
    return this.entities.residents;
  }

  /** @returns the number of available entities */
  get vacancies(): number {
    return this.entities.vacancies;
  }

  addComponentsToEntity(...components: Component<any>[]) {
    const adder = this.componentManager.addComponentsToEntity(components);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (entity: Entity, properties?: Record<string, SchemaProps<unknown>>): World => {
      if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      this.archetypeManager.updateArchetype(entity, adder(entity, properties));
      return self;
    };
  }

  /** @returns the next available Entity or `undefined` if no Entity is available */
  createEntity(): Entity | undefined {
    const entity = this.entities.acquire() as Entity;
    if (entity < 0) return;
    this.archetypeManager.setArchetype(entity, this.archetypeManager.rootArchetype);
    return entity;
  }

  /** Remove and recycle an Entity */
  destroyEntity(entity: Entity): World {
    if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
    this.archetypeManager.resetArchetype(entity);
    this.entities.release(entity);
    return this;
  }

  getComponentInstance<T extends Schema<T>>(component: Component<T>): ComponentInstance<T> | undefined {
    return this.componentManager.componentMap.get(component);
  }

  getEntityProperties(entity: Entity): Record<string, SchemaProps<unknown>> {
    const archetype = this.archetypeManager.getEntityArchetype(entity);
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

  getQueryComponents(query: Query): ComponentRecord {
    return this.queryManager.getComponentsFromQuery(query);
  }

  getQueryEntered(query: Query, arr: Entity[] = []): Entity[] {
    return this.queryManager.getEnteredFromQuery(query, arr);
  }

  getQueryEntities(query: Query, arr: Entity[] = []): Entity[] {
    return this.queryManager.getEntitiesFromQuery(query, arr);
  }

  getQueryExited(query: Query, arr: Entity[] = []): Entity[] {
    return this.queryManager.getExitedFromQuery(query, arr);
  }

  hasComponent<T extends Schema<T>>(component: Component<T>): (entity: Entity) => Boolean {
    const instance = this.componentManager.getInstance(component);
    if (!instance) throw new Error("Component is not registered.");
    return (entity: Entity) => instance[$_OWNERS].isOn(entity);
  }

  hasComponents(...components: Component<any>[]): (entity: Entity) => Boolean[] {
    const instances = this.componentManager.getInstances(components).filter((x) => x) as ComponentInstance<any>[];
    if (instances.length !== components.length) throw new Error("Not all components registered!");
    return (entity: Entity): Boolean[] => {
      return instances.map((component) => component[$_OWNERS].isOn(entity));
    };
  }

  /**
   * @return `true` if the Entity is valid and exists in the world
   * @throws if the entity is invalid
   */
  isEntityActive(entity: Entity): boolean {
    if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
    return this.entities.isOn(entity);
  }

  /** @return `true` if the given entity is valid for the given capacity */
  isValidEntity(entity: Entity): entity is Entity {
    return isUint32(entity) && entity < this.entities.size;
  }

  /** Swap the ComponentBuffer of one world with this world */
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

  removeComponentsFromEntity(...components: Component<any>[]): (entity: Entity) => World {
    const remover = this.componentManager.removeComponentsFromEntity(components);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (entity: Entity) => {
      if (!this.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      this.archetypeManager.updateArchetype(entity, remover(entity)); /** @todo probably don't want to do this each loop */
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
