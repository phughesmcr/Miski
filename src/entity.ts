"use strict";

import { updateEntityArchetype } from "./archetype.js";
import { QueryInstance, removeArchetypeFromQuery } from "./query.js";
import { indexOf } from "./utils.js";
import { World } from "./world.js";

/** Entities are indexes */
export type Entity = number;

/**
 * Create an entity in the world
 * @param world the world to create the entity in
 * @returns the entity
 */
export async function createEntity(world: World): Promise<Entity> {
  if (!world) throw new SyntaxError("Entity creation requires a World object.");
  const idx = await indexOf(world.entities, undefined);
  if (idx === -1) throw new Error("Maximum entities reached.");
  await updateEntityArchetype(world, idx);
  return idx;
}

/**
 * Remove an entity from the world and destroy any component data associated
 * @param world the world the entity is associated with
 * @param entity the entity to destroy
 * @returns the world
 */
export async function destroyEntity(world: World, entity: Entity): Promise<World> {
  if (!world) throw new SyntaxError("Entity destruction requires a World object.");
  if (typeof entity !== "number") throw new SyntaxError("Invalid or undefined entity provided.");
  const { archetypes, spec, entities, queries } = world;
  if (entity < 0 || entity > spec.maxEntities) throw new Error(`Entity is out of range.`);
  const archetype = entities[entity];
  delete entities[entity];
  if (archetype === undefined) return world;
  archetype.entities.delete(entity);

  // @todo this is a dual concern
  if (archetype.entities.size === 0) {
    const _removeArchetype = (query: QueryInstance) => removeArchetypeFromQuery(query, archetype);
    await Promise.all([...queries.values()].map(_removeArchetype));
    delete archetypes[archetype.name];
  }
  return world;
}
