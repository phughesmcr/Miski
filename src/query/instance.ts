/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import type { Archetype } from "../archetype/archetype.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { Schema } from "../component/schema.js";
import { bitfield, intersectBits, type Bitfield } from "../utils/bits/index.js";
import type { Query } from "./query.js";

export type QueryInstanceSpec = {
  componentMap: Map<Component<any>, ComponentInstance<any>>;
  query: Query;
};

export type QueryInstance = Query & {
  /** A bitfield for the AND match criteria */
  and: Readonly<Bitfield>;
  /** */
  archetypes: Set<Archetype>;
  /** */
  checkCandidacy: (target: number, idx: number) => boolean;
  /** */
  components: Record<string, ComponentInstance<any>>;
  /**
   * `true` if the object is in a dirty state
   *
   * A query becomes dirty when an archetype is added or removed
   */
  isDirty: boolean;
  /** A bitfield for the OR match criteria */
  or: Readonly<Bitfield>;
  /** A bitfield for the NOT match criteria */
  not: Readonly<Bitfield>;
};

export function createQueryInstance(spec: QueryInstanceSpec): QueryInstance {
  const { componentMap, query } = spec;
  const { all, any, none } = query;

  const getComponentInstances = <T extends Schema<T>>(
    arr: ComponentInstance<any>[],
    component: Component<T>,
    idx: number,
  ) => {
    const inst = componentMap.get(component);
    if (!inst) throw new Error(`Component ${component.name} not found.`);
    arr[idx] = inst as ComponentInstance<T>;
    return arr;
  };

  const length = componentMap.size;

  const _allInstances = all.reduce(getComponentInstances, new Array(all.length) as ComponentInstance<any>[]);
  const and = bitfield.fromObjects(length, "id", _allInstances);

  const _anyInstances = any.reduce(getComponentInstances, new Array(any.length) as ComponentInstance<any>[]);
  const or = bitfield.fromObjects(length, "id", _anyInstances);

  const _noneInstances = none.reduce(getComponentInstances, new Array(none.length) as ComponentInstance<any>[]);
  const not = bitfield.fromObjects(length, "id", _noneInstances);

  /** The components matched by the and/or bitfields */
  const components = Object.fromEntries([..._allInstances, ..._anyInstances].map((c) => [c.name, c]));

  const archetypes: Set<Archetype> = new Set();

  const checkCandidacy = (target: number, idx: number): boolean => {
    const OR = or[idx] === 0 || intersectBits(target, or[idx]) > 0;
    if (!OR) return false;
    const AND = intersectBits(target, and[idx]) === and[idx];
    if (!AND) return false;
    return intersectBits(target, not[idx]) === 0;
  };

  return Object.assign(Object.create(query), {
    isDirty: true,
    archetypes,
    and,
    checkCandidacy,
    components,
    not,
    or,
  }) as QueryInstance;
}
