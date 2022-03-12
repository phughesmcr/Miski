/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Bitfield } from "../bitfield.js";
import { Component } from "../component/component.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { Query } from "./query.js";

interface QueryInstanceSpec {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  createBitfieldFromIds: (components: ComponentInstance<unknown>[]) => Bitfield;
  query: Query;
}

export interface QueryInstance extends Query {
  /** A bitfield for the AND match criteria */
  and: Readonly<Bitfield>;
  /** */
  archetypes: Set<Archetype>;
  /** */
  components: Record<string, ComponentInstance<unknown>>;
  /** A bitfield for the OR match criteria */
  or: Readonly<Bitfield>;
  /** A bitfield for the NOT match criteria */
  not: Readonly<Bitfield>;
}

function flattenEntities(this: Entity[], { entities }: Archetype) {
  this.push(...entities);
}

/**
 *
 * @param query
 * @returns
 * @todo cache entities per archetype and add a dirty flag to archetypes - only update entities from dirty archetypes
 */
export function getEntitiesFromQuery(query: QueryInstance): Entity[] {
  const res: Entity[] = [];
  query.archetypes.forEach(flattenEntities, res);
  return res;
}

/**
 *
 * @param query
 * @returns
 */
export function getEnteredFromQuery(query: QueryInstance): Entity[] {
  return [...query.archetypes].flatMap((archetype) => [...archetype.entered]);
}

/**
 *
 * @param query
 * @returns
 */
export function getExitedFromQuery(query: QueryInstance): Entity[] {
  return [...query.archetypes].flatMap((archetype) => [...archetype.exited]);
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

  return Object.freeze(
    Object.assign(Object.create(query), {
      archetypes,
      and,
      components,
      not,
      or,
    }) as QueryInstance,
  );
}
