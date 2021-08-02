"use strict";

import { spliceOne } from "utils.js";
import { ComponentInstance, createBitmaskFromComponents } from "./component.js";
import { Entity } from "./entity.js";
import { Bitmask, getMaskId } from "./mask.js";
import { World } from "./world.js";

/** Archetypes are unique groupings of entities by components */
export interface Archetype {
  components: Set<ComponentInstance<unknown>>;
  entities: Set<Entity>;
  mask: Bitmask;
  id: number;
}

/**
 * Creates a new archetype
 * @param world the world associated with the components
 * @param components the components to create the archetype from
 * @returns the new archetype object
 */
export async function createArchetype(world: World, ...components: ComponentInstance<unknown>[]): Promise<Archetype> {
  const mask = await createBitmaskFromComponents(world, ...components);
  return {
    components: new Set(components),
    entities: new Set(),
    mask,
    id: getMaskId(mask),
  };
}

/**
 * Handles the swapping, creation and destruction of archetypes for entities
 * @param world the world associated with the entity and components
 * @param entity the entity to update
 * @param component optional components to add to the entity's archetype
 * @returns the updated or new archetype
 */
export async function updateEntityArchetype<T>(
  world: World,
  entity: Entity,
  component?: ComponentInstance<T>,
  removal = false
): Promise<Archetype> {
  const { archetypes, entities, queries } = world;
  const instances = [...queries.values()];

  let components: ComponentInstance<unknown>[] = [];

  const currentArchetype = entities[entity];
  if (currentArchetype) {
    currentArchetype.entities.delete(entity);
    components = [...currentArchetype.components];
    if (currentArchetype.entities.size === 0) {
      const _removeArchetype = (query: QueryInstance) => removeArchetypeFromQuery(query, currentArchetype);
      await Promise.all(instances.map(_removeArchetype));
      delete archetypes[currentArchetype.name];
    }
  }

  if (component) {
    if (removal === false) {
      components.push(component);
    } else {
      const idx = components.indexOf(component);
      if (idx > -1) spliceOne(components, idx);
    }
  }

  const _tmp = await createArchetype(world, ...components);

  let archetype: Archetype;
  if (_tmp.name in archetypes) {
    archetype = archetypes[_tmp.name];
    if (archetype === undefined) throw new Error("Could not get archetype");
  } else {
    archetype = _tmp;
    archetypes[archetype.name] = archetype;
    const _isMatch = (query: QueryInstance) => isQueryCandidate(query, archetype);
    await Promise.all(instances.map(_isMatch));
  }

  archetype.entities.add(entity);
  entities[entity] = archetype;
  return archetype;
}
