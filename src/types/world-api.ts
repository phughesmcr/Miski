import type { Query } from "@/query/query.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { WorldArchetypeAPI } from "@/types/world-archetype-api.ts";
import type { WorldComponentAPI } from "@/types/world-component-api.ts";
import type { WorldEntityAPI } from "@/types/world-entity-api.ts";
import type { WorldSystemAPI } from "@/types/world-system-api.ts";

export type { ComponentBundle, ComponentBundleEntryFor, ComponentBundleEntryInput } from "@/types/component-bundle.ts";
export type {
  ComponentInstanceGetter,
  QueryManagerDependencies,
  WorldComponentAPI,
} from "@/types/world-component-api.ts";
export type { WorldEntityAPI } from "@/types/world-entity-api.ts";
export type { WorldSystemAPI } from "@/types/world-system-api.ts";
export type { WorldArchetypeAPI } from "@/types/world-archetype-api.ts";

/** The specification for a World */
export type WorldSpec = {
  /** The maximum capacity of any World */
  capacity: number;
  /** The components to register in the World */
  components: DynamicComponent[];
};

/** The state of a World */
export type WorldState = "uninitialized" | "initialized" | "destroyed" | "error";

/** Public world surface available to systems and external callers. */
export type WorldContext = {
  readonly state: WorldState;
  readonly components: WorldComponentAPI;
  readonly entities: WorldEntityAPI;
  readonly systems: WorldSystemAPI;
  readonly archetypes: WorldArchetypeAPI;
  init(): Promise<void>;
  destroy(): Promise<void>;
  refresh(): void;
  frame<T>(fn: () => T): T;
  queryRevision(query: Query): number;
};

/** The result of a World API constructor */
export type WorldAPIResult = {
  /** The Archetype API */
  archetypes: WorldArchetypeAPI;
  /** The Component API */
  components: WorldComponentAPI;
  /** The Entity API */
  entities: WorldEntityAPI;
  /** The System API */
  systems: WorldSystemAPI;
};
