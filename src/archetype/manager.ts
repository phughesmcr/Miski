/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../bitfield.js";
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
  toggleBit: (bit: number, bitfield: Bitfield) => Bitfield;
}

interface ArchetypeManager {
  archetypeMap: Map<string, Archetype>;
  isArchetypeCandidate: (query: QueryInstance) => (archetype: Archetype) => boolean;
  refreshArchetype: (archetype: Archetype) => Archetype;
  purgeArchetypeCaches: (archetype: Archetype) => Archetype;
  updateArchetype: (entity: Entity, component: number | number[]) => Archetype;
}

export function createArchetypeManager(spec: ArchetypeManagerSpec): ArchetypeManager {
  const { EMPTY_BITFIELD, getEntityArchetype, setEntityArchetype, toggleBit } = spec;

  /** An empty archetype for use in cloning etc. */
  const EMPTY_ARCHETYPE = createArchetype({ bitfield: EMPTY_BITFIELD });

  /** Map<Archetype ID, Archetype> */
  const archetypeMap: Map<string, Archetype> = new Map();

  const cloneArchetypeWithToggle = (archetype: Archetype, component: number | number[]): [string, () => Archetype] => {
    const { bitfield, cloneCache } = archetype;

    if (!Array.isArray(component)) {
      const cached = cloneCache.get(component);
      if (cached) return [cached.id, () => cached];
      component = [component];
    }

    const bitfieldCopy = bitfield.slice() as Bitfield;
    component.forEach((id) => toggleBit(id, bitfieldCopy));
    const bitfieldId = bitfieldCopy.toString();

    return [
      bitfieldId,
      () => {
        const clone = createArchetype({ bitfield: bitfieldCopy, id: bitfieldId });
        if (!Array.isArray(component)) cloneCache.set(component, clone);
        return clone;
      },
    ];
  };

  /** @returns `true` if the query criteria match this archetype */
  const isArchetypeCandidate = (query: QueryInstance): ((archetype: Archetype) => boolean) => {
    return function (archetype: Archetype): boolean {
      const { bitfield, candidateCache } = archetype;
      if (candidateCache.has(query)) return candidateCache.get(query) || false;
      const { and = EMPTY_BITFIELD, or = EMPTY_BITFIELD, not = EMPTY_BITFIELD } = query;
      const checkStatus = (target: number, i: number): boolean => {
        const _and = and[i]!;
        return (not[i]! & target) === 0 && (_and & target) === _and && (or[i]! & target) <= 0;
      };
      const status = bitfield.every(checkStatus);
      candidateCache.set(query, status);
      return status;
    };
  };

  /**
   * Update an entity's archetype
   * @param entity the entity to update
   * @param component the component to toggle
   * @returns the entity's new archetype
   */
  const updateArchetype = (entity: Entity, component: number | number[]): Archetype => {
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
