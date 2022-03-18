/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../bitfield.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { QueryInstance } from "../query/instance.js";
import { addEntityToArchetype, Archetype, createArchetype, removeEntityFromArchetype } from "./archetype.js";

interface ArchetypeManagerSpec {
  EMPTY_ARCHETYPE: Archetype;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => boolean;
  toggleBit: (bit: number, bitfield: Bitfield) => boolean;
}

interface ArchetypeManager {
  archetypeMap: Map<string, Archetype>;
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype;
}

function getCandidateStatus(query: QueryInstance) {
  const { and, or, not } = query;
  return (target: number, idx: number): boolean => {
    const AND = and ? (and[idx] ?? 0 & target) === and[idx] : true;
    const OR = or ? (or[idx] ?? 0 & target) <= 0 : true;
    const NOT = not ? (not[idx] ?? 0 & target) === 0 : true;
    return NOT && AND && OR;
  };
}

/** @returns `true` if the query criteria match this archetype */
export function isArchetypeCandidate(query: QueryInstance): (archetype: Archetype) => boolean {
  const checkStatus = getCandidateStatus(query);
  return function (archetype: Archetype): boolean {
    const { bitfield, candidateCache } = archetype;
    if (candidateCache.has(query)) return candidateCache.get(query) ?? false;
    const status = bitfield.every(checkStatus);
    candidateCache.set(query, status);
    return status;
  };
}

export function createArchetypeManager(spec: ArchetypeManagerSpec): ArchetypeManager {
  const { EMPTY_ARCHETYPE, getEntityArchetype, setEntityArchetype, toggleBit } = spec;

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
    updateArchetype,
  };
}
