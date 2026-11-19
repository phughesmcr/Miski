import type { Entity } from "@/entity/entity.ts";

/** The public archetype inspection API. */
export type WorldArchetypeAPI = {
  /** Get the archetype ID of an entity */
  getEntityArchetype: (entity: Entity) => string | undefined;
  /** Check if an entity is in the root (empty) archetype */
  isEntityInRoot(entity: Entity): boolean;
};
