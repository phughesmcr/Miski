"use strict";

import { Archetype } from "./archetype.js";
import { ComponentInstance } from "./component.js";
import { Query, QueryInstance } from "./query.js";
import { SystemInstance } from "./system.js";

const DEFAULT_MAX_COMPONENTS = 128;
const DEFAULT_MAX_ENTITIES = 10_000;

/** World configuration */
export interface WorldSpec {
  /**
   * The maximum number of components allowed in the world.
   * Defaults to 128.
   */
  maxComponents: number;
  /**
   * The maximum number of entities allowed in the world.
   * Defaults to 10,000.
   */
  maxEntities: number;
}

/** The default world specification */
export const defaultWorldSpec: WorldSpec = {
  maxComponents: DEFAULT_MAX_COMPONENTS,
  maxEntities: DEFAULT_MAX_ENTITIES,
};

/** World is the primary ECS context */
export interface World {
  // meta
  spec: Readonly<WorldSpec>;
  id: string;
  // storage
  archetypes: Record<string, Archetype>;
  components: ComponentInstance<unknown>[];
  entities: Archetype[];
  queries: Map<Query, QueryInstance>;
  systems: SystemInstance[];
}

/**
 * Create new world context
 * @param spec optional specification object.
 * @param spec.maxComponents the maximum number of components allowed in the world. Defaults to 128.
 * @param spec.maxEntities the maximum number of entities allowed in the world. Defaults to 10,000.
 */
export function createWorld(spec: Partial<WorldSpec> = defaultWorldSpec): World {
  const { maxComponents = DEFAULT_MAX_COMPONENTS, maxEntities = DEFAULT_MAX_ENTITIES } = spec;
  return {
    archetypes: {},
    components: new Array(maxComponents) as ComponentInstance<unknown>[],
    entities: new Array(maxEntities) as Archetype[],
    id: `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`,
    queries: new Map(),
    spec: Object.freeze({ maxComponents, maxEntities }),
    systems: [],
  };
}
