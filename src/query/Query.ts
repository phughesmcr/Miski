/**
 * @module      Query
 * @description A Query is a collection of Components that can be used to find Entities
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { BooleanArray } from "@phughesmcr/booleanarray";
import { type ComponentInstance, SpecError, type World } from "../../mod.ts";
import { type Component, isValidComponentArray } from "../component/Component.ts";
import type { QueryInstance, QuerySpec, SchemaOrNull } from "../types.ts";
import type { Archetype } from "../archetype/Archetype.ts";

export function createQueryInstance(world: World, query: Query): QueryInstance {
  const registry = world.components.registry;
  const size = world.components.count;

  const andInstances = query.all.map((component) => registry[component.name]).filter(Boolean) as ComponentInstance<
    SchemaOrNull
  >[];
  const and = new BooleanArray(size);
  for (const instance of andInstances) {
    and.setBool(instance.id, true);
  }

  const or = new BooleanArray(size);
  const orInstances = query.any.map((component) => registry[component.name]).filter(Boolean) as ComponentInstance<
    SchemaOrNull
  >[];
  for (const instance of orInstances) {
    or.setBool(instance.id, true);
  }

  const not = new BooleanArray(size);
  const notInstances = query.none.map((component) => registry[component.name]).filter(Boolean) as ComponentInstance<
    SchemaOrNull
  >[];
  for (const instance of notInstances) {
    not.setBool(instance.id, true);
  }

  const components: Record<string, ComponentInstance<SchemaOrNull>> = {};
  for (const instance of andInstances) {
    components[instance.name] = instance;
  }
  for (const instance of orInstances) {
    components[instance.name] = instance;
  }

  const archetypes = new Set<Archetype>();

  const checkCandidacy = (target: number, idx: number): boolean => {
    // OR: either no components specified (or[idx] === 0) or at least one bit matches
    // arr[idx]! is safe because (any number & undefined) === 0
    const OR = or[idx] === 0 || (target & or[idx]!) !== 0;
    if (!OR) return false;

    // AND: all required bits must be present
    const AND = (target & and[idx]!) === and[idx];
    if (!AND) return false;

    // NOT: no forbidden bits should be present
    return (target & not[idx]!) === 0;
  };

  return {
    and,
    or,
    not,
    archetypes,
    checkCandidacy,
    components: {},
    isDirty: true,
  };
}

/**
 * Type guard for QuerySpec
 * @param spec The specification object to check
 * @returns `true` if the spec is valid, `false` otherwise
 */
export const isValidQuerySpec = (spec: unknown): spec is QuerySpec => {
  if (!isObject(spec)) return false;
  const { all, any, none } = spec as QuerySpec;
  if (!all && !any && !none) return false;
  if (all && !isValidComponentArray(all)) return false;
  if (any && !isValidComponentArray(any)) return false;
  if (none && !isValidComponentArray(none)) return false;
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
   * @param spec The Query's specification object
   * @param spec.all `AND` - Gather entities as long as they have all these components
   * @param spec.any `OR` - Gather entities as long as they have 0...* of these components
   * @param spec.none `NOT` - Gather entities as long as they don't have these components
   * @returns A new Query object
   * @throws {SpecError} if the spec is invalid
   */
  constructor(spec: QuerySpec) {
    if (!isValidQuerySpec(spec)) {
      throw new SpecError("Query specification object is invalid.");
    }
    this.all = Object.freeze([...new Set(spec.all ?? [])]);
    this.any = Object.freeze([...new Set(spec.any ?? [])]);
    this.none = Object.freeze([...new Set(spec.none ?? [])]);
  }
}
