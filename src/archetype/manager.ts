/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../bitfield.js";
import { ComponentInstance } from "../component/instance.js";
import { EMPTY_ARRAY } from "../constants.js";
import { Entity } from "../entity.js";
import { QueryInstance } from "../query/instance.js";
import {
  addEntityToArchetype,
  Archetype,
  createArchetype,
  removeEntityFromArchetype,
  purgeArchetypeCaches,
  refreshArchetype,
} from "./archetype.js";

interface ArchetypeManagerSpec {
  EMPTY_BITFIELD: Bitfield;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => boolean;
  toggleBit: (bit: number, bitfield: Bitfield) => boolean;
}

interface ArchetypeManager {
  archetypeMap: Map<string, Archetype>;
  isArchetypeCandidate: (query: QueryInstance) => (archetype: Archetype) => boolean;
  refreshArchetype: (archetype: Archetype) => Archetype;
  purgeArchetypeCaches: (archetype: Archetype) => Archetype;
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype;
}

/** @returns `true` if the query criteria match this archetype */
function isArchetypeCandidate(query: QueryInstance): (archetype: Archetype) => boolean {
  const { and = EMPTY_ARRAY, or = EMPTY_ARRAY, not = EMPTY_ARRAY } = query;
  const _checkStatus = (target: number, i: number): boolean => {
    return (not[i]! & target) === 0 && (and[i]! & target) === and[i]! && (or[i]! & target) <= 0;
  };
  return function (archetype: Archetype): boolean {
    const { bitfield, candidateCache } = archetype;
    if (candidateCache.has(query)) return candidateCache.get(query) ?? false;
    const status = bitfield.every(_checkStatus);
    candidateCache.set(query, status);
    return status;
  };
}

export function createArchetypeManager(spec: ArchetypeManagerSpec): ArchetypeManager {
  const { EMPTY_BITFIELD, getEntityArchetype, setEntityArchetype, toggleBit } = spec;

  /** An empty archetype for use in cloning etc. */
  const EMPTY_ARCHETYPE = createArchetype({ bitfield: EMPTY_BITFIELD });

  /** Map<Archetype ID, Archetype> */
  const archetypeMap: Map<string, Archetype> = new Map();

  const cloneArchetypeWithToggle = (
    archetype: Archetype,
    component: ComponentInstance<unknown> | ComponentInstance<unknown>[],
  ): [string, () => Archetype] => {
    const { bitfield, cloneCache } = archetype;

    if (!Array.isArray(component)) {
      const cached = cloneCache.get(component);
      if (cached) return [cached.id, () => cached];
      component = [component];
    }

    const bitfieldCopy = bitfield.slice() as Bitfield;
    const components = component.reduce((res, instance) => {
      const isOn = toggleBit(instance.id, bitfieldCopy); // this is also modifying bitfieldCopy
      if (isOn) res.push(instance);
      return res;
    }, [] as ComponentInstance<unknown>[]);
    const bitfieldId = bitfieldCopy.toString();

    return [
      bitfieldId,
      () => {
        const clone = createArchetype({ bitfield: bitfieldCopy, id: bitfieldId });
        archetype.components.forEach((c) => clone.components.add(c));
        components.forEach((c) => clone.components.add(c));
        if (!Array.isArray(component)) cloneCache.set(component, clone);
        return clone;
      },
    ];
  };

  /**
   * Update an entity's archetype
   * @param entity the entity to update
   * @param component the component to toggle
   * @returns the entity's new archetype
   */
  const updateArchetype = (
    entity: Entity,
    component: ComponentInstance<unknown> | ComponentInstance<unknown>[],
  ): Archetype => {
    const previousArchetype = getEntityArchetype(entity);
    let nextArchetype: Archetype | undefined;
    if (previousArchetype) {
      removeEntityFromArchetype(entity, previousArchetype);
      const [id, factory] = cloneArchetypeWithToggle(previousArchetype, component);
      if (archetypeMap.has(id)) {
        nextArchetype = archetypeMap.get(id)!;
      } else {
        nextArchetype = factory();
        archetypeMap.set(id, nextArchetype);
      }
    } else {
      const [id, factory] = cloneArchetypeWithToggle(EMPTY_ARCHETYPE, component);
      if (archetypeMap.has(id)) {
        nextArchetype = archetypeMap.get(id)!;
      } else {
        nextArchetype = factory();
        archetypeMap.set(id, nextArchetype);
      }
    }
    addEntityToArchetype(entity, nextArchetype);
    setEntityArchetype(entity, nextArchetype);
    return nextArchetype;
  };

  return {
    archetypeMap,
    isArchetypeCandidate,
    purgeArchetypeCaches,
    refreshArchetype,
    updateArchetype,
  };
}
