"use strict";

import { Component } from '../component/component';
import { componentsToArchetype } from '../utils';
import { Entity } from './entity';
import { EntityPool, createPool } from "./entity_pool";

export interface EntityManagerSpec {
  initialPoolSize: number;
  maxEntities: number;
}

export interface EntityManager {
  createEntity: () => Entity;
  destroyEntity: (entity: Entity) => boolean;
  getEntityById: (id: string) => Entity | undefined;
  getEntities: () => Entity[];
  getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
  getEntitiesByMask: (mask: bigint, exact?: boolean) => Entity[];
  rebuildArchetypes: () => void;
  updateArchetype: (entity: Entity, previous?: bigint) => Entity;
  areArchetypesDirty: () => boolean;
  cleanedArchetypes: () => boolean;
}

export function createEntityManager(spec: EntityManagerSpec): EntityManager {
  const { initialPoolSize, maxEntities } = { ...spec };
  const _pool: EntityPool = createPool({initialPoolSize, maxEntities});
  const _registry: Record<string, Entity> = {};

  // archetypes
  const _archetypes: Map<bigint, Set<Entity>> = new Map() as Map<bigint, Set<Entity>>;
  let _dirty = true;

  const createEntity = (): Entity => {
    const entity = _pool.get();
    if (!entity) throw new Error('no entities left!');
    _registry[entity.id] = entity;
    updateArchetype(entity);
    return entity;
  };

  const destroyEntity = (entity: Entity): boolean => {
    const success = (entity.id in _registry);
    if (success === true) {
      delete _registry[entity.id];
      const archetype = entity.getArchetype();
      _archetypes.get(archetype)?.delete(entity);
      if (_archetypes.get(archetype)?.size === 0) {
        _archetypes.delete(archetype);
        _dirty = true;
      }
      _pool.release(entity);
    }
    return success;
  };

  const getEntityById = (id: string): Entity | undefined => _registry[id];

  const getEntities = (): Entity[] => Object.values(_registry);

  const getEntitiesByComponents = (...components: Component<unknown>[]): Entity[] => {
    const mask = componentsToArchetype(...components);
    return getEntitiesByMask(mask);
  };

  const getEntitiesByMask = (mask: bigint, exact = false): Entity[] => {
    if (exact) {
      return Array.from(_archetypes.get(mask) ?? []);
    } else {
      const _entities: Set<Entity> = new Set();
      if (_dirty === true) {
        _archetypes.forEach((entities, archetype) => {
          if ((archetype & mask) === mask) {
            entities.forEach((entity) => _entities.add(entity));
          }
        });
      } else {
        _archetypes.forEach((entities, archetype) => {
          if ((archetype & mask) === mask) {
            entities.forEach((entity) => _entities.add(entity));
          }
        });
      }
      return [..._entities];
    }
  };

  const updateArchetype = (entity: Entity, previous?: bigint): Entity => {
    if (previous != undefined) {
      _archetypes.get(previous)?.delete(entity);
    }
    const archetype = entity.getArchetype();
    if (_archetypes.has(archetype)) {
      _archetypes.get(archetype)?.add(entity);
    } else {
      _archetypes.set(archetype, new Set([entity]));
      _dirty = true;
    }
    return entity;
  };

  const rebuildArchetypes = (): void => {
    _archetypes.clear();
    const entities = getEntities();
    for (let i = 0; i < entities.length; i++) {
      updateArchetype(entities[i]);
    }
    _dirty = false;
  };

  const areArchetypesDirty = (): boolean => _dirty;

  const cleanedArchetypes = (): boolean => _dirty = false;

  return Object.freeze({
    createEntity,
    destroyEntity,
    getEntityById,
    getEntities,
    getEntitiesByComponents,
    getEntitiesByMask,
    rebuildArchetypes,
    updateArchetype,
    areArchetypesDirty,
    cleanedArchetypes,
  });
}
