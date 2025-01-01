/**
 * @module      QueryManager
 * @description The QueryManager is responsible for creating, registering, and destroying queries.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { createQueryInstance, type Query } from "./Query.ts";
import type { Entity, QueryInstance } from "../types.ts";
import type { World } from "../world/World.ts";

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

  entities(query: Query): IterableIterator<Entity> {
    const instance = this.#register(query);
  }

  stringify() {}
}
