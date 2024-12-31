/**
 * @module      Query
 * @description A Query is a collection of Components that can be used to find Entities
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { isObject } from "../utils.ts";
import { SpecError } from "../errors.ts";
import { type Component, isValidComponentArray } from "../component/Component.ts";
import type { Archetype } from "../archetype/Archetype.ts";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { QueryInstance, QuerySpec, SchemaOrNull } from "../types.ts";
import type { World } from "../world/World.ts";

/**
 * Creates a runtime instance of a Query for efficient entity matching
 * @param world - The World instance containing the component registry
 * @param query - The Query definition specifying component requirements
 * @returns A QueryInstance.
 */
export function createQueryInstance(world: World, query: Query): QueryInstance {
  // Get component registry and size for bit array creation
  const registry = world.components.registry;
  const size = world.components.count;

  const getInstance = (component: Component<SchemaOrNull>) => registry[component.name];
  const getInstances = (array: Readonly<Component<SchemaOrNull>[]>): ComponentInstance<SchemaOrNull>[] => {
    return array.map(getInstance).filter(Boolean) as ComponentInstance<SchemaOrNull>[];
  };

  // Create AND bit array - marks required components
  const andInstances = getInstances(query.all);
  const and = new BooleanArray(size);
  for (const instance of andInstances) {
    and.setBool(instance.id, true);
  }

  // Create OR bit array - marks optional components (need at least one)
  const orInstances = getInstances(query.any);
  const or = new BooleanArray(size);
  for (const instance of orInstances) {
    or.setBool(instance.id, true);
  }

  // Create NOT bit array - marks forbidden components
  const notInstances = getInstances(query.none);
  const not = new BooleanArray(size);
  for (const instance of notInstances) {
    not.setBool(instance.id, true);
  }

  // Build lookup table for quick component access
  const components: Record<string, ComponentInstance<SchemaOrNull>> = {};
  for (const instance of [...andInstances, ...orInstances]) {
    components[instance.name] = instance;
  }

  // Initialize empty set for matching archetypes
  const archetypes = new Set<Archetype>();

  // Optimized candidacy check using bitwise operations
  const checkCandidacy = (target: number, idx: number): boolean => {
    // Check OR first for early exit
    const OR = or[idx] === 0 || (target & or[idx]!) !== 0;
    if (!OR) return false;

    // Verify all required components are present
    const AND = (target & and[idx]!) === and[idx];
    if (!AND) return false;

    // Ensure no forbidden components exist
    return (target & not[idx]!) === 0;
  };

  // turn the three arrays into a string
  const id = `${and.toString()},${or.toString()},${not.toString()}`;

  return { and, or, not, archetypes, checkCandidacy, components, isDirty: true, id };
}

/**
 * Type guard for QuerySpec
 * @param spec The specification object to check
 * @returns `true` if the spec is valid, `false` otherwise
 */
export const isValidQuerySpec = (spec: unknown): spec is QuerySpec => {
  if (isObject(spec) === false) return false;
  const { all, any, none } = spec as QuerySpec;
  if (all == undefined && any == undefined && none == undefined) return false;
  if (all && isValidComponentArray(all) === false) return false;
  if (any && isValidComponentArray(any) === false) return false;
  if (none && isValidComponentArray(none) === false) return false;
  return true;
};

/** A Query is a collection of Components that can be used to find Entities */
export class Query {
  /** `AND` - Gather entities as long as they have all these components */
  readonly all: Readonly<Component<SchemaOrNull>[]>;

  /** `OR` - Gather entities as long as they have 0...* of these components */
  readonly any: Readonly<Component<SchemaOrNull>[]>;

  /** `NOT` - Gather entities as long as they don't have these components */
  readonly none: Readonly<Component<SchemaOrNull>[]>;

  /**
   * Create a new Query
   * @param spec - The Query's specification object
   * @param spec.all - `AND` - Gather entities as long as they have all these components
   * @param spec.any - `OR` - Gather entities as long as they have 0...* of these components
   * @param spec.none - `NOT` - Gather entities as long as they don't have these components
   * @returns A new Query object
   * @throws {SpecError} if the spec is invalid
   */
  constructor(spec: QuerySpec) {
    if (isValidQuerySpec(spec) === false) {
      throw new SpecError("Query specification object is invalid.");
    }
    this.all = Object.freeze([...new Set(spec.all ?? [])]);
    this.any = Object.freeze([...new Set(spec.any ?? [])]);
    this.none = Object.freeze([...new Set(spec.none ?? [])]);
  }
}
