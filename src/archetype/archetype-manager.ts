// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from '../component/component';
import { Entity } from '../entity/entity';
import { bitIntersection } from '../utils';
import { World } from '../world';
import { Archetype } from './archetype';

export interface ArchetypeManagerSpec {
  [key: string]: unknown;
}

export interface ArchetypeManager {
  getArchetype: (id: bigint) => Archetype | undefined;
  getArchetypes: () => Archetype[];
  getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
  isArchetypeRegistered: (archetype: Archetype) => boolean;
  updateArchetype: (entity: Entity, prev?: bigint) => World;
}

function createGetArchetype(registry: Map<bigint, Archetype>) {
  return function getArchetype(id: bigint): Archetype | undefined {
    return registry.get(id);
  };
}

function createGetArchetypes(registry: Map<bigint, Archetype>) {
  return function getArchetypes(): Archetype[] {
    return [...registry.values()];
  };
}

function createGetEntitiesByComponents(registry: Map<bigint, Archetype>) {
  return function getEntitiesByComponents(...components: Component<unknown>[]): Entity[] {
    const entities: Set<Entity> = new Set();
    components.forEach((component) => {
      registry.forEach((archetype, id) => {
        if (bitIntersection(component.id, id) > 0) {
          archetype.entities.forEach((entity) => entities.add(entity));
        }
      });
    });
    return [...entities];
  };
}

function createIsArchetypeRegistered(registry: Map<bigint, Archetype>) {
  return function isArchetypeRegistered(archetype: Archetype): boolean {
    return registry.has(archetype.id) || [...registry.values()].includes(archetype);
  };
}

function createUpdateArchetype(registry: Map<bigint, Archetype>, world: World) {
  return function updateArchetype(entity: Entity, previous?: bigint): World {
    if (previous !== undefined) {
      const archetype = registry.get(previous);
      if (archetype) {
        archetype.removeEntity(entity);
        if (archetype.isEmpty()) {
          registry.delete(previous);
        }
      }
    }
    const current = entity.archetype;
    if (registry.has(current)) {
      registry.get(current)?.addEntity(entity);
    } else {
      registry.set(current, new Archetype(current, [entity]));
    }
    return world;
  };
}

export function createArchetypeManager(world: World, _spec: ArchetypeManagerSpec): ArchetypeManager {
  const registry: Map<bigint, Archetype> = new Map();

  return {
    getArchetype: createGetArchetype(registry),
    getArchetypes: createGetArchetypes(registry),
    getEntitiesByComponents: createGetEntitiesByComponents(registry),
    isArchetypeRegistered: createIsArchetypeRegistered(registry),
    updateArchetype: createUpdateArchetype(registry, world),
  };
}
