/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Archetype } from "../archetype/archetype.js";
import type { Bitfield } from "../bitfield.js";
import { $_DIRTY } from "../constants.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { Query } from "./query.js";

interface QueryInstanceSpec {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  createBitfieldFromIds: (components: ComponentInstance<unknown>[]) => Bitfield;
  query: Query;
}

export interface QueryInstance extends Query {
  /** @private Provides a getter and setter for the `isDirty` flag */
  [$_DIRTY]: boolean;
  /** A bitfield for the AND match criteria */
  and: Readonly<Bitfield>;
  /** */
  archetypes: Set<Archetype>;
  /** */
  components: Record<string, ComponentInstance<unknown>>;
  /** `true` if the object is in a dirty state */
  isDirty: boolean;
  /** A bitfield for the OR match criteria */
  or: Readonly<Bitfield>;
  /** A bitfield for the NOT match criteria */
  not: Readonly<Bitfield>;
}

/**
 *
 * @param world
 * @param query
 * @returns
 */
export function createQueryInstance(spec: QueryInstanceSpec): QueryInstance {
  const { createBitfieldFromIds, componentMap, query } = spec;
  const { all, any, none } = query;

  /** */
  const getComponentInstances = <T>(arr: ComponentInstance<unknown>[], component: Component<T>, idx: number) => {
    const inst = componentMap.get(component);
    if (!inst) throw new Error(`Component ${component.name} not found.`);
    arr[idx] = inst as ComponentInstance<T>;
    return arr;
  };

  /** */
  const _allInstances = all.reduce(getComponentInstances, new Array(all.length) as ComponentInstance<unknown>[]);

  /** */
  const and = createBitfieldFromIds(_allInstances);

  /** */
  const _anyInstances = any.reduce(getComponentInstances, new Array(any.length) as ComponentInstance<unknown>[]);

  /** */
  const or = createBitfieldFromIds(_anyInstances);

  /** */
  const _noneInstances = none.reduce(getComponentInstances, new Array(none.length) as ComponentInstance<unknown>[]);

  /** */
  const not = createBitfieldFromIds(_noneInstances);

  /** The components matched by the and/or bitfields */
  const components: Record<string, ComponentInstance<unknown>> = [..._allInstances, ..._anyInstances].reduce(
    (components, component) => {
      components[component.name] = component;
      return components;
    },
    {} as Record<string, ComponentInstance<unknown>>,
  );
  Object.freeze(components);

  /** */
  const archetypes: Set<Archetype> = new Set();

  let isDirty = true;

  return Object.assign(Object.create(query), {
    get [$_DIRTY](): boolean {
      return isDirty;
    },
    set [$_DIRTY](dirty: boolean) {
      isDirty = !!dirty;
    },
    get isDirty(): boolean {
      return isDirty;
    },
    archetypes,
    and,
    components,
    not,
    or,
  }) as QueryInstance;
}
