// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from '../component/component';
import { Entity } from '../entity/entity';
import { bitIntersection } from '../utils';
import { World } from '../world';

type ArchetypeRegistry = Map<bigint, Set<Entity>>;

export interface ArchetypeManagerSpec {
  [key: string]: unknown;
}

export interface ArchetypeManager {
  /**
   * Add entities to an archetype
   * @param archetype the archetype bigint id
   * @param entities the entities to add to the archetype
   * @returns the world
   */
  addEntitiesToArchetype: (archetype: bigint, ...entities: Entity[]) => World;
  /** @returns an array of all the archetypes in the world */
  getArchetypes: () => [bigint, Set<Entity>][];
  /**
   * Find an archetype by its id
   * @param archetype the archetype's bigint id
   */
  getEntitiesFromArchetype: (archetype: bigint) => Set<Entity> | undefined;
  /** Find entities by components */
  getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
  /** @returns true if the archetype has no entities */
  isArchetypeEmpty: (archetype: bigint) => boolean;
  /**
   * Remove entities from an archetype
   * @param archetype the archetype bigint id
   * @param entities the entities to remove from the archetype
   * @returns the world
   */
  removeEntitiesFromArchetype: (archetype: bigint, ...entities: Entity[]) => World;
  /**
   * Update the archetype of an entity.
   * You probably don't want to use this manually as the
   * archetype system handles this automatically.
   */
  updateArchetype: (entity: Entity, prev?: bigint) => World;
}

// eslint-disable-next-line max-len
function createAddEntitiesToArchetype(registry: ArchetypeRegistry, world: World): (archetype: bigint, ...entities: Entity[]) => World {
  return function addEntitiesToArchetype(archetype: bigint, ...entities: Entity[]): World {
    if (registry.has(archetype)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const set = registry.get(archetype)!;
      entities.forEach((entity) => set.add(entity));
      return world;
    } else {
      throw new SyntaxError(`Archetype "${archetype}" does not exist.`);
    }
  };
}

function createGetArchetypes(registry: Map<bigint, Set<Entity>>) {
  return function getArchetypes(): [bigint, Set<Entity>][] {
    return [...registry.entries()];
  };
}

function createGetEntitiesFromArchetype(registry: ArchetypeRegistry) {
  return function getEntitiesFromArchetype(id: bigint): Set<Entity> | undefined {
    return registry.get(id);
  };
}

function createGetEntitiesByComponents(registry: ArchetypeRegistry) {
  return function getEntitiesByComponents(...components: Component<unknown>[]): Entity[] {
    const entities: Set<Entity> = new Set();
    components.forEach((component) => {
      registry.forEach((archetype, id) => {
        if (bitIntersection(component.id, id) > 0) {
          archetype.forEach((entity) => entities.add(entity));
        }
      });
    });
    return [...entities];
  };
}

function createIsArchetypeEmpty(registry: ArchetypeRegistry): (id: bigint) => boolean {
  return function isArchetypeEmpty(id: bigint): boolean {
    return Boolean(registry.get(id)?.size === 0);
  };
}

// eslint-disable-next-line max-len
function createRemoveEntitiesFromArchetype(registry: ArchetypeRegistry, world: World): (archetype: bigint, ...entities: Entity[]) => World {
  return function removeEntitiesFromArchetype(archetype: bigint, ...entities: Entity[]): World {
    if (registry.has(archetype)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const set = registry.get(archetype)!;
      entities.forEach((entity) => set.delete(entity));
      return world;
    } else {
      throw new SyntaxError(`Archetype "${archetype}" does not exist.`);
    }
  };
}

function createUpdateArchetype(registry: ArchetypeRegistry, world: World) {
  return function updateArchetype(entity: Entity, previous?: bigint): World {
    if (previous !== undefined) {
      const archetype = registry.get(previous);
      if (archetype) {
        archetype.delete(entity);
        if (archetype.size === 0) {
          registry.delete(previous);
        }
      }
    }
    const current = entity.getArchetype();
    if (registry.has(current)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      registry.get(current)!.add(entity);
    } else {
      registry.set(current, new Set([entity]));
    }
    return world;
  };
}

export function createArchetypeManager(world: World, _spec: ArchetypeManagerSpec): ArchetypeManager {
  const registry: ArchetypeRegistry = new Map();

  return {
    addEntitiesToArchetype: createAddEntitiesToArchetype(registry, world),
    getArchetypes: createGetArchetypes(registry),
    getEntitiesFromArchetype: createGetEntitiesFromArchetype(registry),
    getEntitiesByComponents: createGetEntitiesByComponents(registry),
    isArchetypeEmpty: createIsArchetypeEmpty(registry),
    removeEntitiesFromArchetype: createRemoveEntitiesFromArchetype(registry, world),
    updateArchetype: createUpdateArchetype(registry, world),
  };
}
