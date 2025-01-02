/**
 * @module      QueryManager
 * @description The QueryManager is responsible for creating, registering, and destroying queries.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { createQueryInstance, type Query } from "./Query.ts";
import type { Entity, QueryInstance, SchemaOrNull } from "../types.ts";
import type { World } from "../world/World.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";

/** The QueryManager is responsible for creating, registering, and destroying queries. */
export class QueryManager {
  /** Map of registered Queries and their instances */
  registry: Map<Query, QueryInstance>;

  #register: (query: Query) => QueryInstance;

  /**
   * Create a new QueryManager
   * @param world - The World instance containing the component registry
   */
  constructor(world: World) {
    this.registry = new Map();

    // Setup the registrar
    this.#register = (query: Query): QueryInstance => {
      if (this.registry.has(query)) {
        return this.registry.get(query)!;
      }
      const instance = createQueryInstance(world, query);
      this.registry.set(query, instance);
      return instance;
    };
  }

  add(query: Query): QueryInstance {
    const instance = this.#register(query);
    this.registry.set(query, instance);
    return instance;
  }

  *entities(query: Query): IterableIterator<Entity> {
    const visited = new Set<Entity>();
    const archetypes = this.registry.get(query)!.archetypes;
    for (const archetype of archetypes) {
      for (const entity of archetype.getEntities()) {
        if (visited.has(entity)) continue;
        visited.add(entity);
        yield entity;
      }
    }
  }

  components(query: Query): Record<string, ComponentInstance<SchemaOrNull>> {
    const archetypes = this.registry.get(query)!.archetypes;
    const res: Record<string, ComponentInstance<SchemaOrNull>> = {}; // TODO: memoize
    for (const archetype of archetypes) {
      for (const component of archetype.components) {
        res[component.name] = component;
      }
    }
    return res;
  }

  stringify() {}
}
