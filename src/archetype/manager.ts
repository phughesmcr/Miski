/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Bitfield } from "../bitfield.js";
import type { ComponentInstance } from "../component/instance.js";
import { $_DIRTY } from "../constants.js";
import type { Entity } from "../entity.js";
import type { QueryInstance } from "../query/instance.js";
import { Query } from "../query/query.js";
import { Archetype, ArchetypeSpec, createArchetype as _createArchetype } from "./archetype.js";

interface ArchetypeManagerSpec {
  capacity: number;
  EMPTY_BITFIELD: Bitfield;
  toggleBit: (bit: number, bitfield: Bitfield) => boolean;
}

interface ArchetypeManager {
  EMPTY_ARCHETYPE: Archetype;
  createArchetype: (spec: ArchetypeSpec) => Archetype;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  isArchetypeCandidate: (archetype: Archetype) => (query: QueryInstance) => boolean;
  purgeArchetypesCaches: () => void;
  refreshArchetypes: (queries: Map<Query, QueryInstance>) => void;
  removeEntityFromArchetype(entity: Entity, archetype: Archetype): Archetype;
  setEntityArchetype: (entity: Entity, archetype: Archetype) => Archetype;
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype;
}

/** Add an Entity to an Archetype's inhabitants list */
function addEntityToArchetype(entity: Entity, archetype: Archetype): Archetype {
  const { entities, entered } = archetype;
  entities.add(entity);
  entered.add(entity);
  archetype[$_DIRTY] = true;
  return archetype;
}

/** For use in the looping over of an Archetype's bitfield */
function getCandidateStatus(query: QueryInstance): (target: number, idx: number) => boolean {
  const { and, or, not } = query;
  return (target: number, idx: number): boolean => {
    const AND = and ? (and[idx] ?? 0 & target) === and[idx] : true;
    const OR = or ? (or[idx] ?? 0 & target) <= 0 : true;
    const NOT = not ? (not[idx] ?? 0 & target) === 0 : true;
    return NOT && AND && OR;
  };
}

/** @returns `true` if the query criteria match this archetype */
function isArchetypeCandidate(archetype: Archetype): (query: QueryInstance) => boolean {
  const { bitfield, candidateCache } = archetype;
  return (query: QueryInstance): boolean => {
    if (candidateCache.has(query)) return candidateCache.get(query) ?? false;
    const checkStatus = getCandidateStatus(query);
    const status = bitfield.every(checkStatus);
    candidateCache.set(query, status);
    return status;
  };
}

/** Purge the `candidate` and `clone` caches in an Archetype */
function purgeArchetypeCaches(archetype: Archetype): Archetype {
  const { candidateCache, cloneCache } = archetype;
  candidateCache.clear();
  cloneCache.clear();
  return archetype;
}

/** Clear the entered/exited list and set `isDirty` to `false` */
function refreshArchetype(archetype: Archetype): Archetype {
  const { entered, exited } = archetype;
  entered.clear();
  exited.clear();
  archetype[$_DIRTY] = false;
  return archetype;
}

/** Remove an Entity from an Archetype's inhabitants list */
function _removeEntityFromArchetype(entity: Entity, archetype: Archetype): Archetype {
  const { entities, exited } = archetype;
  entities.delete(entity);
  exited.add(entity);
  archetype[$_DIRTY] = true;
  return archetype;
}

/** Shorthand utility types */
type ComponentInstances = ComponentInstance<unknown> | ComponentInstance<unknown>[];
type ArchetypeCloneState = [string, () => Archetype];
type ArchetypeCloner = (archetype: Archetype, component: ComponentInstances) => ArchetypeCloneState;

function archetypeCloner(
  createArchetype: (spec: ArchetypeSpec) => Archetype,
  toggleBit: (bit: number, bitfield: Bitfield) => boolean,
): ArchetypeCloner {
  return (archetype: Archetype, component: ComponentInstances): ArchetypeCloneState => {
    const { bitfield, cloneCache } = archetype;

    // If component is single, attempt to get result from Archetype.cloneCache
    if (!Array.isArray(component)) {
      const cached = cloneCache.get(component);
      if (cached) return [cached.id, () => cached];
      component = [component];
    }

    // Clone the Archetype's bitfield
    const bitfieldCopy = bitfield.slice() as Bitfield;

    // Handle toggling of Components in the Archetype
    const components = component.reduce((res, instance) => {
      const isOn = toggleBit(instance.id, bitfieldCopy); // this is also modifying bitfieldCopy
      if (isOn) res.push(instance);
      return res;
    }, [] as ComponentInstance<unknown>[]);

    // Pre-evaluate the bitfield copy's ID after toggling components
    const bitfieldId = bitfieldCopy.toString();

    return [
      bitfieldId,
      () => {
        const clone = createArchetype({ bitfield: bitfieldCopy, id: bitfieldId });
        if (!Array.isArray(component)) cloneCache.set(component, clone);
        const add = <T>(c: ComponentInstance<T>) => {
          if (components.includes(c)) clone.components.add(c);
        };
        archetype.components.forEach(add);
        components.forEach(add);
        return clone;
      },
    ];
  };
}

/** Instantiate World's Archetype functions */
export function createArchetypeManager(spec: ArchetypeManagerSpec): ArchetypeManager {
  const { EMPTY_BITFIELD, capacity, toggleBit } = spec;

  /** Map<Archetype.id, Archetype> */
  const archetypeMap: Map<string, Archetype> = new Map();

  /** arr[entity] = the entity's archetype */
  const entityArchetypes: Archetype[] = [];
  entityArchetypes.length = capacity; // @note V8 hack

  // exported this through the manager for consistency
  const createArchetype = _createArchetype;

  const EMPTY_ARCHETYPE = createArchetype({ bitfield: EMPTY_BITFIELD });

  const cloneArchetypeWithToggle = archetypeCloner(createArchetype, toggleBit);

  /** @returns the Entity's Archetype or undefined if Entity is not alive */
  const getEntityArchetype = (entity: Entity): Archetype | undefined => entityArchetypes[entity];

  const purgeArchetypesCaches = () => archetypeMap.forEach(purgeArchetypeCaches);

  const refreshArchetypes = (queries: Map<Query, QueryInstance>) => {
    archetypeMap.forEach((archetype) => {
      refreshArchetype(archetype);
      const isCandidate = isArchetypeCandidate(archetype);
      // Refresh the Query's Archetype candidate registry
      queries.forEach((query) => {
        if (isCandidate(query)) query.archetypes.add(archetype);
      });
    });
  };

  const removeEntityFromArchetype = (entity: Entity, archetype: Archetype) => {
    delete entityArchetypes[entity];
    return _removeEntityFromArchetype(entity, archetype);
  };

  const setEntityArchetype = (entity: Entity, archetype: Archetype) => (entityArchetypes[entity] = archetype);

  /**
   * Update an entity's archetype
   * @param entity the entity to update
   * @param component the component to toggle
   * @returns the entity's new archetype
   */
  const updateArchetype = (entity: Entity, component: ComponentInstances) => {
    const previousArchetype = getEntityArchetype(entity);
    if (previousArchetype) removeEntityFromArchetype(entity, previousArchetype);
    const [id, factory] = cloneArchetypeWithToggle(previousArchetype ?? EMPTY_ARCHETYPE, component);
    const nextArchetype = archetypeMap.get(id) ?? factory();
    archetypeMap.set(id, nextArchetype);
    addEntityToArchetype(entity, nextArchetype);
    setEntityArchetype(entity, nextArchetype);
    return nextArchetype;
  };

  return {
    EMPTY_ARCHETYPE,
    createArchetype,
    getEntityArchetype,
    isArchetypeCandidate,
    purgeArchetypesCaches,
    refreshArchetypes,
    removeEntityFromArchetype,
    setEntityArchetype,
    updateArchetype,
  };
}
