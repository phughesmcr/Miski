import type { Entity } from "@/entity/entity.ts";
import type { Query } from "@/query/query.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";

/** The public archetype transition and query membership API. */
export type WorldArchetypeAPI = {
  /** Get the archetype ID of an entity */
  getEntityArchetype: (entity: Entity) => string | undefined;
  /** Check if an entity is in the root (empty) archetype */
  isEntityInRoot(entity: Entity): boolean;
  /** Get the components associated with a QueryInstance */
  queryComponents(query: Query): Record<string, DynamicComponentInstance>;
  /** Get the entities associated with a QueryInstance */
  queryEntities(query: Query): IterableIterator<Entity>;
  /** Get entities that entered a query since last refresh */
  queryEntered(query: Query): IterableIterator<Entity>;
  /** Get entities that exited a query since last refresh */
  queryExited(query: Query): IterableIterator<Entity>;
};
