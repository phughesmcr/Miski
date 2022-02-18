/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Component, ComponentRecord } from "../component/component.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { Bitfield } from "../bitfield.js";
import { Query } from "./query.js";

export interface QueryInstanceSpec {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  bitfieldFactory: (components?: ComponentInstance<unknown>[] | undefined) => Readonly<Bitfield>;
  query: Query;
}

export interface QueryInstance {
  /** */
  archetypes: Set<Archetype>;
  /** */
  archetypeCache: Map<Archetype, boolean>;
  /** The components matched by the and/or bitfields */
  components: Readonly<ComponentRecord>;
  /** A bitfield for the AND match criteria */
  and: Readonly<Bitfield> | undefined;
  /** A bitfield for the OR match criteria */
  or: Readonly<Bitfield> | undefined;
  /** A bitfield for the NOT match criteria */
  not: Readonly<Bitfield> | undefined;
  getComponents: () => ComponentRecord;
  getEntities: () => Entity[];
  refresh: (archetypes: Archetype[]) => void;
}

export interface QueryInstanceConstructorSpec {
  /** The components matched by the and/or bitfields */
  components: Readonly<ComponentRecord>;
  /** A bitfield for the AND match criteria */
  and: Readonly<Bitfield> | undefined;
  /** A bitfield for the OR match criteria */
  or: Readonly<Bitfield> | undefined;
  /** A bitfield for the NOT match criteria */
  not: Readonly<Bitfield> | undefined;
}

export function createQueryInstance(spec: QueryInstanceSpec): Readonly<QueryInstance> {
  const { componentMap, bitfieldFactory, query } = spec;

  /** */
  const all: ComponentRecord = {};
  /** */
  const any: ComponentRecord = {};
  /** */
  const none: ComponentRecord = {};

  /** A bitfield for the AND match criteria */
  let and: Readonly<Bitfield> | undefined;
  /** A bitfield for the OR match criteria */
  let or: Readonly<Bitfield> | undefined;
  /** A bitfield for the NOT match criteria */
  let not: Readonly<Bitfield> | undefined;

  if (query.all.length) {
    const instances = query.all.reduce((arr, component) => {
      const inst = componentMap.get(component);
      if (!inst) throw new Error(`Component ${component.name} not found.`);
      all[component.name] = inst;
      arr.push(inst);
      return arr;
    }, [] as ComponentInstance<unknown>[]);
    and = bitfieldFactory(instances);
  }

  if (query.any.length) {
    const instances = query.any.reduce((arr, component) => {
      const inst = componentMap.get(component);
      if (!inst) throw new Error(`Component ${component.name} not found.`);
      any[component.name] = inst;
      arr.push(inst);
      return arr;
    }, [] as ComponentInstance<unknown>[]);
    or = bitfieldFactory(instances);
  }

  if (query.none.length) {
    const instances = query.none.reduce((arr, component) => {
      const inst = componentMap.get(component);
      if (!inst) throw new Error(`Component ${component.name} not found.`);
      none[component.name] = inst;
      arr.push(inst);
      return arr;
    }, [] as ComponentInstance<unknown>[]);
    not = bitfieldFactory(instances);
  }

  /** The components matched by the and/or bitfields */
  const _components = Object.freeze({ ...any, ...all });

  const instance = {
    and,
    archetypeCache: new Map(),
    archetypes: new Set(),
    components: _components,
    not,
    or,
  } as QueryInstance;

  const getComponents = (): ComponentRecord => _components;

  /** @todo cache entities per archetype and add a dirty flag to archetypes - only update entities from dirty archetypes */
  const getEntities = (): Entity[] =>
    [...new Set([...instance.archetypes].flatMap((archetype) => [...archetype.entities]))] as Entity[];

  const refresh = (archetypes: Archetype[]) => {
    archetypes.forEach((archetype) => {
      const cached = instance.archetypeCache.get(archetype);
      if (cached === true) {
        instance.archetypes.add(archetype);
      } else if (cached === false) {
        instance.archetypes.delete(archetype);
      } else {
        if (archetype.isCandidate(instance)) {
          instance.archetypes.add(archetype);
          instance.archetypeCache.set(archetype, true);
        } else {
          instance.archetypes.delete(archetype);
          instance.archetypeCache.set(archetype, false);
        }
      }
    });
  };

  return Object.freeze(Object.assign(instance, { getComponents, getEntities, refresh }));
}
