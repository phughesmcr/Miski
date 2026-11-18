import type { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import type { ComponentManager } from "@/component/component-manager.ts";
import type { EntityManager } from "@/entity/entity-manager.ts";
import type { RelationManager } from "@/relation/relation-manager.ts";

/** Symbol of the World method that exposes its managers to world saves. @internal */
export const worldSaveHost: unique symbol = Symbol("worldSaveHost");

/** What a world save needs from a World. @internal */
export type WorldSaveHost = {
  readonly capacity: number;
  readonly entities: EntityManager;
  readonly components: ComponentManager;
  readonly archetypes: ArchetypeManager;
  /** Relation pair indexes; `undefined` when the world registers no relations. */
  readonly relations: RelationManager | undefined;
  /** Throw unless the world is initialized. */
  readonly assertSaveReady: () => void;
  /** Throw unless the world is initialized and outside a rollback scope. */
  readonly assertLoadReady: () => void;
  /** Invalidate query caches and issue fresh revisions after a load replaced world state. */
  readonly finishLoad: () => void;
};
