"use strict";

import { EntityState } from "./constants.js";
import { updateEntityArchetype } from "./archetype.js";
import { World } from "./world.js";

/** Entities are indexes */
export type Entity = number;

/** An array containing the index of each entity's archetype, or their state */
export type EntityArray = Int16Array & { available: number[] };

/**
 * Creates the storage mechanism for the Entity Archetype array
 * @param world the world to create the EntityArray for
 * @returns the created EntityArray
 */
export function createEntityArray(length: number): EntityArray {
  if (isNaN(length)) throw new TypeError("Array length must be a number.");
  const entities = new Int16Array(length).fill(EntityState.DESTROYED);
  const total = length - 1;
  const available = Array.from({ length }, (_, i) => total - i);
  return Object.assign(entities, { available });
}

/**
 * Create an entity in the world
 * @param world the world to create the entity in
 * @returns the entity or `undefined` if the world has no available entities
 */
export function createEntity(world: World): Entity | undefined {
  if (!world) throw new SyntaxError("Entity creation requires a World object.");
  const idx = world.entities.available.pop();
  if (idx === undefined) return undefined;
  world.entities[idx] = EntityState.EMPTY;
  updateEntityArchetype(world, idx);
  return idx;
}

/**
 * Remove an entity from the world and destroy any component data associated
 * @param world the world the entity is associated with
 * @param entity the entity to destroy
 * @returns the world
 */
export function destroyEntity(world: World, entity: Entity): World {
  if (!world) throw new SyntaxError("Entity destruction requires a World object.");
  if (isNaN(entity)) throw new SyntaxError("Invalid or undefined entity provided.");
  const { spec, entities } = world;
  const { available } = entities;
  const { maxEntities } = spec;
  if (entity < 0 || entity > maxEntities) throw new Error("Entity is out of range.");
  if (available.includes(entity)) return world;
  updateEntityArchetype(world, entity);
  entities.available.push(entity);
  entities[entity] = EntityState.DESTROYED;
  return world;
}
