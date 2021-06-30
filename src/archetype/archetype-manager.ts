/**
 * @name        ArchetypeManager
 * @description The archetype manager creates, destroys & assigns archetypes
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { ComponentInstance } from "../component/component";
import { Entity } from "../entity/entity-manager";
import { createBitmask, isBitOn, toggleBit } from "../utils/bitmasks";
import { World } from "../world";
import { Archetype, createArchetype } from "./archetype";

export type ArchetypeRegistry = Record<string, Archetype>;
export type EntityArchetypeRegistry = Archetype[];

export interface ArchetypeManager {
  getArchetypes: () => Archetype[];
  getEntityArchetype: (entity: number) => Archetype | undefined;
  archetypeHasComponent: <T>(archetype: Archetype, component: ComponentInstance<T>) => boolean;
  resetEntityArchetype: (entity: number) => Archetype;
  updateEntityArchetype: (entity: number, ...components: ComponentInstance<unknown>[]) => Archetype;
}

function _archetypeHasComponent() {
  /**
   * Test if an archetype contains a component
   * @param archetype the archetype to search
   * @param component the component to search for
   * @returns true if the archetype contains the component
   */
  function archetypeHasComponent<T>(archetype: Archetype, component: ComponentInstance<T>): boolean {
    return isBitOn(archetype.mask, component.id);
  }
  return archetypeHasComponent;
}

function _getArchetypes(archetypes: ArchetypeRegistry) {
  /** @returns an array of all archetypes in the world */
  function getArchetypes(): Archetype[] {
    return [...Object.values(archetypes)];
  }
  return getArchetypes;
}

function _getEntityArchetype(entities: EntityArchetypeRegistry) {
  /**
   * Find and return the archetype for a given entity
   * @param entity the entity
   * @returns the entity's archetype or undefined
   */
  function getEntityArchetype(entity: Entity): Archetype | undefined {
    return entities[entity];
  }
  return getEntityArchetype;
}

function _resetEntityArchetype(archetypes: ArchetypeRegistry, entities: EntityArchetypeRegistry, empty: Archetype) {
  function resetEntityArchetype(entity: Entity): Archetype {
    // handling current archetype
    const current = entities[entity];
    if (current !== undefined) {
      current.remove(entity);
      if (current.entities.size === 0) {
        delete archetypes[current.name];
      }
    }
    empty.add(entity);
    entities[entity] = empty;
    return empty;
  }
  return resetEntityArchetype;
}

function _updateEntityArchetype(archetypes: ArchetypeRegistry, entities: EntityArchetypeRegistry, world: World) {
  /**
   * Update an entity's archetype following a change of components
   * @param entity the entity
   * @param component the added / removed component
   * @returns the entity's new archetype
   */
  function updateEntityArchetype(entity: Entity, component: ComponentInstance<unknown>): Archetype {
    const current = entities[entity];
    if (current !== undefined) {
      current.remove(entity);
      if (current.entities.size === 0) {
        world.getQueries().forEach((query) => query.remove(current));
        delete archetypes[current.name];
      }
    }

    if (component?.id === undefined) {
      throw new TypeError(`updateEntityArchetype: Expected component to be an instance!`);
    }

    const mask = entities[entity]?.mask ?? createBitmask(world.config.maxComponents);
    toggleBit(mask, component.id);
    const name = mask.toString();

    let archetype: Archetype;
    if (name in archetypes) {
      archetype = archetypes[name];
    } else {
      archetype = createArchetype(mask);
      world.getQueries().forEach((query) => query.isMatch(archetype));
      archetypes[name] = archetype;
    }

    archetype.add(entity);
    entities[entity] = archetype;
    return archetype;
  }
  return updateEntityArchetype;
}

export function createArchetypeManager(world: World): ArchetypeManager {
  const { maxComponents, maxEntities } = world.config;

  const emptyArchetype = createArchetype(createBitmask(maxComponents));

  const archetypeRegistry: ArchetypeRegistry = {};
  const entityArchetypes: EntityArchetypeRegistry = new Array(maxEntities).fill(emptyArchetype) as Archetype[];

  return {
    archetypeHasComponent: _archetypeHasComponent(),
    getArchetypes: _getArchetypes(archetypeRegistry),
    getEntityArchetype: _getEntityArchetype(entityArchetypes),
    resetEntityArchetype: _resetEntityArchetype(archetypeRegistry, entityArchetypes, emptyArchetype),
    updateEntityArchetype: _updateEntityArchetype(archetypeRegistry, entityArchetypes, world),
  };
}
