/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Bitfield } from "../bitfield.js";
import { Component, ComponentRecord } from "../component/component.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { Query } from "./query.js";

export interface QueryInstanceSpec {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  bitfieldFactory: (components?: ComponentInstance<unknown>[] | undefined) => Readonly<Bitfield>;
  query: Query;
}

export interface QueryInstance extends Query {
  getComponents: () => ComponentRecord;
  /** Entities which have entered this query since last refresh */
  getEntered: () => Entity[];
  getEntities: () => Entity[];
  /** Entities which have exited this query since last refresh */
  getExited: () => Entity[];
  refresh: (archetypes: Archetype[]) => void;
}

export interface QueryData {
  /** A bitfield for the AND match criteria */
  and?: Readonly<Bitfield>;
  /** A bitfield for the OR match criteria */
  or?: Readonly<Bitfield>;
  /** A bitfield for the NOT match criteria */
  not?: Readonly<Bitfield>;
}

export function createQueryInstance(spec: QueryInstanceSpec): Readonly<QueryInstance> {
  const { componentMap, query, bitfieldFactory } = spec;

  const archetypes: Set<Archetype> = new Set();

  /** The components matched by the and/or bitfields */
  const components: Record<string, ComponentInstance<unknown>> = {};

  const fields: QueryData = {};

  const getComponentInstances = (arr: ComponentInstance<unknown>[], component: Component<unknown>) => {
    const inst = componentMap.get(component);
    if (!inst) throw new Error(`Component ${component.name} not found.`);
    arr.push(inst);
    return arr;
  };

  const mapCompo = <T>(component: ComponentInstance<T>) => {
    components[component.name] = component;
  };

  if (query.all.length) {
    const instances = query.all.reduce(getComponentInstances, []);
    instances.forEach(mapCompo);
    fields.and = bitfieldFactory(instances);
  }

  if (query.any.length) {
    const instances = query.any.reduce(getComponentInstances, []);
    instances.forEach(mapCompo);
    fields.or = bitfieldFactory(instances);
  }

  if (query.none.length) {
    const instances = query.none.reduce(getComponentInstances, []);
    fields.not = bitfieldFactory(instances);
  }

  // Lock component object
  Object.freeze(components);

  const getComponents = (): ComponentRecord => components;

  /** @todo cache entities per archetype and add a dirty flag to archetypes - only update entities from dirty archetypes */
  const getEntities = (): Entity[] => [...archetypes].flatMap((archetype) => [...archetype.entities]);

  const getEntered = (): Entity[] => [...archetypes].flatMap((archetype) => [...archetype.entered]);

  const getExited = (): Entity[] => [...archetypes].flatMap((archetype) => [...archetype.exited]);

  const refresher = (archetype: Archetype) => {
    if (archetype.isCandidate(fields)) {
      archetypes.add(archetype);
    }
  };

  const refresh = (archetypes: Archetype[]) => archetypes.forEach(refresher);

  return Object.freeze(
    Object.assign(Object.create(query), {
      getComponents,
      getEntered,
      getEntities,
      getExited,
      refresh,
    }) as QueryInstance,
  );
}
