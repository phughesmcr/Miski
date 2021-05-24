"use strict";

import { Pool } from '../pool/pool';
import { World } from '../world';
import { Entity } from './entity';

export interface EntityManagerSpec {
  entityPoolGrowthFactor: number;
  initialEntityPoolSize: number;
  maxEntities: number;
}

export interface EntityManager {
  /** @returns a new entity */
  createEntity: () => Entity;
  /**
   * Destroys an entity and returns it to the object pool
   * @returns true if the entity was successfully destroyed.
   */
  destroyEntity: (entity: Entity) => boolean;
  /** @returns an array of all entities in the world */
  getEntities: () => Entity[];
  /**
   * Find an entity by its id
   * @param id the entity's id string
   */
  getEntityById: (id: string) => Entity | undefined;
  /** @returns true if the entity is registered in this world */
  isEntityRegistered: (entity: Entity) => boolean;
}

function createCreateEntity(pool: Pool<Entity>, registry: Map<string, Entity>, world: World) {
  return function createEntity(): Entity {
    const entity = pool.get();
    if (!entity || !(entity instanceof Entity)) {
      throw new Error('No entities left! Pool is empty.');
    }
    registry.set(entity.id, entity);
    world.updateArchetype(entity);
    return entity;
  };
}

function createDestroyEntity(pool: Pool<Entity>, registry: Map<string, Entity>, world: World) {
  return function destroyEntity(entity: Entity): boolean {
    if (entity === world.global) {
      throw new Error('Destroying the global entity is forbidden.');
    }
    if (registry.has(entity.id)) {
      world.getArchetype(entity.getArchetype())?.removeEntity(entity);
      registry.delete(entity.id);
      pool.release(entity);
      return true;
    } else {
      return false;
    }
  };
}

function createGetEntities(registry: Map<string, Entity>) {
  return function getEntities(): Entity[] {
    return [...registry.values()];
  };
}

function createGetEntityById(registry: Map<string, Entity>) {
  return function getEntityById(id: string): Entity | undefined {
    return registry.get(id);
  };
}

function createIsEntityRegistered(registry: Map<string, Entity>) {
  return function isEntityRegistered(entity: Entity): boolean {
    return registry.has(entity.id) || [...registry.values()].includes(entity);
  };
}

/**
 * Creates a new entity manager object
 * @param world the world object to associate this manager with
 * @param spec the entity manager's specification object
 * @param spec.initialEntityPoolSize the number of entities to pre-allocate in the object pool
 * @param spec.maxEntities the maximum number of entities this manager can register
 * @returns an entity manager object
 */
export function createEntityManager(world: World, spec: EntityManagerSpec): EntityManager {
  const { entityPoolGrowthFactor, initialEntityPoolSize, maxEntities } = spec;

  const pool: Pool<Entity> = new Pool({
    create: function() { return new Entity(world); },
    destroy: function(entity: Entity) { entity.clear(); },
    initialSize: initialEntityPoolSize,
    growthFactor: entityPoolGrowthFactor,
    maxSize: maxEntities,
    world,
  });

  const registry: Map<string, Entity> = new Map() as Map<string, Entity>;

  return {
    createEntity: createCreateEntity(pool, registry, world),
    destroyEntity: createDestroyEntity(pool, registry, world),
    getEntities: createGetEntities(registry),
    getEntityById: createGetEntityById(registry),
    isEntityRegistered: createIsEntityRegistered(registry),
  };
}
