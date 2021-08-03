/**
 * The EntityArray contains either these states or archetypes.
 * States must be negative numbers as positive numbers are
 * the index of the entity's archetype in world.archetypes.
 */
export const enum EntityState {
  /** Empty but in-use */
  EMPTY = -1,
  /** Empty and out-of-use */
  DESTROYED = -2,
}

export const DEFAULT_MAX_COMPONENTS = 128;

export const DEFAULT_MAX_ENTITIES = 10_000;

export const VALID_COMPONENT_KEY = Symbol();

export const VALID_SCHEMA_KEY = Symbol();
