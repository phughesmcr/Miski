/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * Archetypes are unique groupings of Entities by Components
 * An archetype must have:
 *  - A unique ID
 *  - A Set of Entity inhabitants
 *  - A way of knowing which Components are represented (Bitfield)
 *  - A way of checking if a QueryInstance matches the Archetype's Components
 */

import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { Bitfield } from "../bitfield.js";
import { QueryInstance } from "../query/instance.js";

export interface ArchetypeSpec {
  /** Optional */
  id?: string;
  /** The Bitfield */
  bitfield: Bitfield;
}

export interface Archetype {
  /** Set of Entities which inhabit this Archetype */
  entities: Set<Entity>;
  /** The Archetype's unique ID */
  id: string;
  /** The Archetype's Component Bitfield */
  bitfield: Bitfield;
  /** Add an entity to the inhabitants list */
  addEntity: (entity: Entity) => Archetype;
  /** @returns an array of Entities which inhabit this Archetype */
  getEntities: () => Entity[];
  /** @returns `true` if the Entity inhabits this Archetype */
  hasEntity: (entity: Entity) => boolean;
  /** Remove an entity from the inhabitants list */
  removeEntity: (entity: Entity) => Archetype;
  /** @returns a clone on this archetype */
  cloneWithToggle: <T>(component: ComponentInstance<T>) => Archetype;
  /** Get the ID of an archetype based on this with a toggled component */
  cloneInStep: <T>(component: ComponentInstance<T>) => [string, () => Archetype];
  /** @returns `true` if the query criteria match this archetype */
  isCandidate: (spec: QueryInstance) => boolean;
}

function validateSpec(spec: ArchetypeSpec): Required<ArchetypeSpec> {
  if (!spec) throw new SyntaxError("Archetype: specification object required.");
  const { bitfield, id } = spec;
  if (!bitfield) throw new SyntaxError("Archetype: spec.bitfield is required.");
  return { bitfield, id: id || bitfield.toString() };
}

function entityFns(state: Archetype) {
  const { entities } = state;
  return {
    /** Add an entity to the inhabitants list */
    addEntity: function (entity: Entity): Archetype {
      entities.add(entity);
      return state;
    },
    /** @returns an array of Entities which inhabit this Archetype */
    getEntities: function (): Entity[] {
      return [...entities];
    },
    /** @returns `true` if the Entity inhabits this Archetype */
    hasEntity: function (entity: Entity): boolean {
      return entities.has(entity);
    },
    /** Remove an entity from the inhabitants list */
    removeEntity: function (entity: Entity): Archetype {
      entities.delete(entity);
      return state;
    },
  };
}

function cloner(state: Archetype) {
  const { bitfield } = state;
  const cache: Map<ComponentInstance<unknown>, Archetype> = new Map();
  return {
    /** @returns a clone on this archetype */
    cloneWithToggle: function <T>(component: ComponentInstance<T>): Archetype {
      if (cache.has(component)) return cache.get(component)!;
      const { id } = component;
      const bitfieldCopy = bitfield.copy().toggle(id);
      const clone = createArchetype({ bitfield: bitfieldCopy, id: bitfieldCopy.toString() });
      cache.set(component, clone);
      return clone;
    },
    cloneInStep: function <T>(component: ComponentInstance<T>): [string, () => Archetype] {
      if (cache.has(component)) {
        const cached = cache.get(component)!;
        return [cached.id, () => cached];
      } else {
        const { id } = component;
        const bitfieldCopy = bitfield.copy().toggle(id);
        return [
          bitfieldCopy.toString(),
          function () {
            const clone = createArchetype({ bitfield: bitfieldCopy, id: bitfieldCopy.toString() });
            cache.set(component, clone);
            return clone;
          },
        ];
      }
    },
  };
}

function candidateChecker(state: Archetype) {
  const { bitfield } = state;
  const _bitfield = bitfield.array;
  const _empty: number[] = [];
  const cache: Map<QueryInstance, boolean> = new Map();
  return {
    /** @returns `true` if the query criteria match this archetype */
    isCandidate: function (query: QueryInstance): boolean {
      if (cache.has(query)) return cache.get(query) || false;
      const { and, or, not } = query;
      const _not = not?.array ?? _empty;
      const _and = and?.array ?? _empty;
      const _or = or?.array ?? _empty;
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
  };
}

/** Archetypes are unique groupings of entities by components */
export function createArchetype(spec: ArchetypeSpec): Archetype {
  const { id, bitfield } = validateSpec(spec);
  const entities: Set<Entity> = new Set();
  const data = { entities, id, bitfield } as Archetype;
  const { addEntity, getEntities, removeEntity } = entityFns(data);
  const { cloneWithToggle, cloneInStep } = cloner(data);
  const { isCandidate } = candidateChecker(data);
  const result = Object.assign(data, {
    addEntity,
    getEntities,
    removeEntity,
    cloneInStep,
    cloneWithToggle,
    isCandidate,
  });
  return Object.freeze(result);
}
