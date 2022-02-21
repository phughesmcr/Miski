/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * Archetypes are unique groupings of Entities by Components
 * An archetype must have:
 *  - A unique ID
 *  - A Set of Entity inhabitants
 *  - A way of knowing which Components are represented (Bitfield)
 *  - A way of checking if a QueryInstance matches the Archetype's Components
 */

import { Bitfield } from "../bitfield.js";
import { ComponentInstance } from "../component/instance.js";
import { EMPTY_ARRAY } from "../constants.js";
import { Entity } from "../entity.js";
import { QueryData } from "../query/instance.js";

export interface ArchetypeSpec {
  /** The Bitfield */
  bitfield: Bitfield;
  /** Optional */
  id?: string;
}

export interface Archetype {
  /** The Archetype's Component Bitfield */
  bitfield: Bitfield;
  /** Entities which have entered this archetype since last refresh */
  entered: Set<Entity>;
  /** Set of Entities which inhabit this Archetype */
  entities: Set<Entity>;
  /** Entities which have exited this archetype since last refresh */
  exited: Set<Entity>;
  /** The Archetype's unique ID */
  id: string;
  /** Add an entity to the inhabitants list */
  addEntity: (entity: Entity) => Archetype;
  /** Get the ID of an archetype based on this with a toggled component */
  cloneInStep: <T>(component: ComponentInstance<T>) => [string, () => Archetype];
  /** @returns a clone on this archetype */
  cloneWithToggle: <T>(component: ComponentInstance<T>) => Archetype;
  /** @returns an iterator of Entities which inhabit this Archetype */
  getEntities: () => IterableIterator<Entity>;
  /** @returns `true` if the Entity inhabits this Archetype */
  hasEntity: (entity: Entity) => boolean;
  /** @returns `true` if the query criteria match this archetype */
  isCandidate: (query: QueryData) => boolean;
  /** Purge various archetype related caches */
  purge: () => void;
  /** Remove an entity from the inhabitants list */
  removeEntity: (entity: Entity) => Archetype;
  /** Run archetype maintenance functions */
  refresh: () => void;
}

function validateSpec(spec: ArchetypeSpec): Required<ArchetypeSpec> {
  if (!spec) throw new SyntaxError("Archetype: specification object required.");
  const { bitfield, id } = spec;
  if (!bitfield) throw new SyntaxError("Archetype: spec.bitfield is required.");
  return { bitfield, id: id || bitfield.toString() };
}

function entityFns(state: Archetype) {
  const { entities, entered, exited } = state;
  return {
    /** Add an entity to the inhabitants list */
    addEntity: function (entity: Entity): Archetype {
      entities.add(entity);
      entered.add(entity);
      return state;
    },
    /** @returns an array of Entities which inhabit this Archetype */
    getEntities: function (): IterableIterator<Entity> {
      return entities.values();
    },
    /** @returns `true` if the Entity inhabits this Archetype */
    hasEntity: function (entity: Entity): boolean {
      return entities.has(entity);
    },
    /** Remove an entity from the inhabitants list */
    removeEntity: function (entity: Entity): Archetype {
      entities.delete(entity);
      exited.add(entity);
      return state;
    },
  };
}

function cloner(state: Archetype) {
  const { bitfield } = state;
  const cache: Map<ComponentInstance<unknown>, Archetype> = new Map();
  return {
    cloneInStep: function <T>(component: ComponentInstance<T>): [string, () => Archetype] {
      if (cache.has(component)) {
        const cached = cache.get(component)!;
        return [cached.id, () => cached];
      } else {
        const { id } = component;
        const bitfieldCopy = bitfield.copy().toggle(id);
        const bitfieldId = bitfieldCopy.toString();
        return [
          bitfieldId,
          function () {
            const clone = createArchetype({ bitfield: bitfieldCopy, id: bitfieldId });
            cache.set(component, clone);
            return clone;
          },
        ];
      }
    },
    /** @returns a clone on this archetype */
    cloneWithToggle: function <T>(component: ComponentInstance<T>): Archetype {
      if (cache.has(component)) return cache.get(component)!;
      const { id } = component;
      const bitfieldCopy = bitfield.copy().toggle(id);
      const clone = createArchetype({ bitfield: bitfieldCopy });
      cache.set(component, clone);
      return clone;
    },
    purgeCloneCache: function () {
      return cache.clear();
    },
  };
}

function candidateChecker(state: Archetype) {
  const { bitfield } = state;
  const _bitfield = bitfield.array;
  const cache: Map<QueryData, boolean> = new Map();
  return {
    /** @returns `true` if the query criteria match this archetype */
    isCandidate: function (query: QueryData): boolean {
      if (cache.has(query)) return cache.get(query) || false;
      const { and, or, not } = query;
      const _not = not?.array ?? EMPTY_ARRAY;
      const _and = and?.array ?? EMPTY_ARRAY;
      const _or = or?.array ?? EMPTY_ARRAY;
      function checkStatus(target: number, i: number): boolean {
        // is ?? 0 right here??
        const _n = _not[i] ?? 0;
        const _a = _and[i] ?? 0;
        const _o = _or[i] ?? 0;
        if ((_n & target) !== 0) return false;
        if ((_a & target) !== _a) return false;
        if ((_o & target) > 0) return false;
        return true;
      }
      const status = _bitfield.every(checkStatus);
      cache.set(query, status);
      return status;
    },
    purgeCandidateCache: function () {
      return cache.clear();
    },
  };
}

/** Archetypes are unique groupings of entities by components */
export function createArchetype(spec: ArchetypeSpec): Archetype {
  const { bitfield, id } = validateSpec(spec);
  const entered: Set<Entity> = new Set();
  const entities: Set<Entity> = new Set();
  const exited: Set<Entity> = new Set();
  const data = { bitfield, entered, entities, exited, id } as Archetype;
  const { addEntity, getEntities, removeEntity } = entityFns(data);
  const { cloneInStep, cloneWithToggle, purgeCloneCache } = cloner(data);
  const { isCandidate, purgeCandidateCache } = candidateChecker(data);
  const refresh = () => {
    entered.clear();
    exited.clear();
  };
  const purge = () => {
    purgeCandidateCache();
    purgeCloneCache();
  };
  return Object.freeze(
    Object.assign(data, {
      addEntity,
      cloneInStep,
      cloneWithToggle,
      getEntities,
      isCandidate,
      purge,
      refresh,
      removeEntity,
    }),
  );
}
