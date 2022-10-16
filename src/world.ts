/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ArchetypeManager } from "./archetype/manager.js";
import { ComponentManager } from "./component/manager.js";
import { VERSION } from "./constants.js";
import { EntityManager } from "./entity.js";
import { QueryManager } from "./query/manager.js";
import { Query } from "./query/query.js";
import { isUint32 } from "./utils/utils.js";
import type { Component } from "./component/component.js";
import type { ComponentInstance } from "./component/instance.js";
import type { ComponentRecord } from "./component/manager.js";
import type { Entity } from "./entity.js";
import type { Schema, SchemaProps } from "./component/schema.js";

export interface WorldData {
  buffer: ArrayBuffer;
  capacity: number;
  version: string;
}

export interface WorldSpec {
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** Components to instantiate in the world  */
  components: Component<any>[];
}

function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  if (!spec) throw new SyntaxError("World creation requires a specification object.");
  const { capacity, components } = spec;
  if (!isUint32(capacity)) throw new SyntaxError("World: spec.capacity invalid.");
  if (!components.length) throw new SyntaxError("World: spec.components invalid.");
  return { ...spec, components: [...new Set(components)] };
}

export class World {
  /** @private */
  #archetypeManager: ArchetypeManager;
  /** @private */
  #componentManager: ComponentManager;
  /** @private */
  #entityManager: EntityManager;
  /** @private */
  #queryManager: QueryManager;

  readonly version = VERSION;

  constructor(spec: WorldSpec) {
    const { capacity, components } = validateWorldSpec(spec);
    this.#archetypeManager = new ArchetypeManager({ capacity, components });
    this.#componentManager = new ComponentManager({ capacity, components });
    this.#entityManager = new EntityManager({ capacity });
    this.#queryManager = new QueryManager({ componentManager: this.#componentManager });
    this.refresh();
    Object.freeze(this);
  }

  /** @returns the maximum number of entities the world can hold */
  get capacity(): number {
    return this.#entityManager.capacity;
  }

  /** @returns the number of available entities */
  get vacancies(): number {
    return this.#entityManager.getVacancies();
  }

  addComponentsToEntity(
    ...components: Component<any>[]
  ): (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => World {
    const adder = this.#componentManager.addComponentsToEntity(components);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => {
      if (!this.#entityManager.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      const added = adder(entity, properties);
      this.#archetypeManager.updateArchetype(entity, added); /** @todo probably don't want to do this each loop */
      return self;
    };
  }

  /** @returns the next available Entity or `undefined` if no Entity is available */
  createEntity(): Entity | undefined {
    const entity = this.#entityManager.createEntity();
    if (entity === undefined) return;
    this.#archetypeManager.setEntityArchetype(entity, this.#archetypeManager.rootArchetype);
    return entity;
  }

  /** Remove and recycle an Entity */
  destroyEntity(entity: Entity): World {
    if (!this.#entityManager.isValidEntity(entity)) return this;
    this.#archetypeManager.removeEntityArchetype(entity);
    this.#entityManager.destroyEntity(entity);
    return this;
  }

  getEntityProperties(entity: Entity): Record<string, SchemaProps<unknown>> {
    const archetype = this.#archetypeManager.getEntityArchetype(entity);
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
    return this.#queryManager.getComponentsFromQuery(query);
  }

  getQueryEntered(query: Query): Entity[] {
    return this.#queryManager.getEnteredFromQuery(query);
  }

  getQueryEntities(query: Query, arr: Entity[] = []): Entity[] {
    return this.#queryManager.getEntitiesFromQuery(query, arr);
  }

  getQueryExited(query: Query): Entity[] {
    return this.#queryManager.getExitedFromQuery(query);
  }

  hasComponents(...components: Component<any>[]) {
    const instances = components
      .map((component) => this.#componentManager.getInstance(component))
      .filter((x) => x) as ComponentInstance<any>[];
    if (instances.length !== components.length) throw new Error("Not all components registered!");
    return (entity: Entity) => {
      const archetype = this.#archetypeManager.getEntityArchetype(entity);
      if (!archetype) return false;
      return instances.every((instance) => archetype.components.includes(instance));
    };
  }

  /** @return `true` if the Entity !== undefined */
  hasEntity(entity: Entity): boolean {
    return this.#entityManager.isValidEntity(entity) && this.#archetypeManager.getEntityArchetype(entity) !== undefined;
  }

  load(data: WorldData): World {
    const { buffer, capacity, version } = data;
    if (version !== this.version) {
      throw new Error(`Version mismatch. Trying to load ${version} data into ${this.version} world.`);
    }
    if (capacity !== this.capacity) {
      throw new Error(`Capacity mismatch. Data requires a world with a capacity of ${capacity}.`);
    }
    this.#componentManager.setBuffer(buffer);
    this.refresh();
    return this;
  }

  refresh(): World {
    this.#queryManager.refreshQueries();
    this.#archetypeManager.refreshArchetypes(this.#queryManager.queryMap);
    this.#componentManager.refreshComponents();
    return this;
  }

  removeComponentsFromEntity(...components: Component<any>[]): (entity: Entity) => World {
    const remover = this.#componentManager.removeComponentsFromEntity(components);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (entity: Entity) => {
      if (!this.#entityManager.isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      const removed = remover(entity);
      this.#archetypeManager.updateArchetype(entity, removed); /** @todo probably don't want to do this each loop */
      return self;
    };
  }

  save(): WorldData {
    return Object.freeze({
      buffer: this.#componentManager.getBuffer(),
      capacity: this.capacity,
      version: this.version,
    });
  }
}
