"use strict";

import { spliceOne } from "./utils.js";
import { ComponentInstance, createBitmaskFromComponents } from "./component.js";
import { Entity } from "./entity.js";
import { Bitmask, getMaskId } from "./mask.js";
import { addArchetypeToQuery, isQueryCandidate, QueryInstance, removeArchetypeFromQuery } from "./query.js";
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
export function createArchetype(world: World, ...components: ComponentInstance<unknown>[]): Archetype {
  const mask = createBitmaskFromComponents(world, ...components);
  return {
    components: new Set(components),
    entities: new Set(),
    mask,
    id: getMaskId(mask),
  };
}

/**
 * Remove an archetype from the world
 * @param world the world to remove the archetype from
 * @param archetype the archetype to remove
 * @param idx the index of the archetype in world.archetypes
 * @returns the removed archetype
 */
export function deleteArchetype(world: World, archetype: Archetype, idx?: number): Archetype {
  const { archetypes, queries } = world;
  if (idx === undefined || idx === -1) {
    idx = [...archetypes.values()].findIndex((a) => a.id === archetype.id);
    if (idx === -1) throw new Error("not found");
  }
  if (archetypes.get(idx) !== archetype) {
    throw new Error("mismatch");
  }
  const _removeArchetype = (query: QueryInstance) => removeArchetypeFromQuery(query, archetype);
  [...queries.values()].forEach(_removeArchetype);
  archetypes.delete(idx);
  return archetype;
}

/**
 * Handles the swapping, creation and destruction of archetypes for entities
 * @param world the world associated with the entity and components
 * @param entity the entity to update
 * @param component optional components to add to the entity's archetype
 * @returns the updated or new archetype
 */
export function updateEntityArchetype<T>(
  world: World,
  entity: Entity,
  component?: ComponentInstance<T>,
  removal = false
): Archetype {
  const { archetypes, entities } = world;

  const cidx = entities[entity];
  if (cidx === undefined || cidx < -1) {
    throw new Error("Entity is not available!");
  }

  let components: ComponentInstance<unknown>[] = [];

  const old = archetypes.get(cidx);
  if (old) {
    components = [...old.components];
    old.entities.delete(entity);
    if (old.entities.size === 0) deleteArchetype(world, old, cidx);
  }

  if (component) {
    if (removal === false) {
      components.push(component);
    } else {
      const idx = components.indexOf(component);
      if (idx > -1) spliceOne(components, idx);
    }
  }

  const tmp = createArchetype(world, ...components);
  const { id } = tmp;
  const archetype = archetypes.get(id);

  if (archetype === undefined) {
    const { queries } = world;
    for (const query of queries.values()) {
      if (isQueryCandidate(query, tmp)) {
        addArchetypeToQuery(query, tmp);
      }
    }
    entities[entity] = id;
    tmp.entities.add(entity);
    archetypes.set(id, tmp);
    return tmp;
  } else {
    entities[entity] = archetype.id;
    archetype.entities.add(entity);
    return archetype;
  }
}
