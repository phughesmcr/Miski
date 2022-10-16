/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../utils/bitfield.js";
import type { Archetype } from "../archetype/archetype.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { Query } from "./query.js";
import type { Schema } from "../component/schema.js";

interface QueryInstanceSpec {
  componentMap: Map<Component<any>, ComponentInstance<any>>;
  query: Query;
}

export interface QueryInstance extends Query {
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
}

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
  const and = Bitfield.fromObjects(length, "id", _allInstances);

  const _anyInstances = any.reduce(getComponentInstances, new Array(any.length) as ComponentInstance<any>[]);
  const or = Bitfield.fromObjects(length, "id", _anyInstances);

  const _noneInstances = none.reduce(getComponentInstances, new Array(none.length) as ComponentInstance<any>[]);
  const not = Bitfield.fromObjects(length, "id", _noneInstances);

  /** The components matched by the and/or bitfields */
  const components: Record<string, ComponentInstance<any>> = [..._allInstances, ..._anyInstances].reduce(
    (res, component) => {
      res[component.name] = component;
      return res;
    },
    {} as Record<string, ComponentInstance<any>>,
  );
  Object.freeze(components);

  const archetypes: Set<Archetype> = new Set();

  const checkCandidacy = (target: number, idx: number): boolean => {
    const OR = or[idx] === 0 || Bitfield.intersectBits(target, or[idx]) > 0;
    if (!OR) return false;
    const AND = Bitfield.intersectBits(target, and[idx]) === and[idx];
    if (!AND) return false;
    return Bitfield.intersectBits(target, not[idx]) === 0;
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
