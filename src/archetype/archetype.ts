/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../bitfield.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { QueryInstance } from "../query/instance.js";

interface ArchetypeSpec {
  /** The Bitfield */
  bitfield: Bitfield;
  /** Optional */
  id?: string;
}

export interface Archetype {
  /** The Archetype's Component Bitfield */
  bitfield: Bitfield;
  /** */
  candidateCache: Map<QueryInstance, boolean>;
  /** */
  cloneCache: Map<ComponentInstance<unknown>, Archetype>;
  /** Entities which have entered this archetype since last refresh */
  entered: Set<Entity>;
  /** Set of Entities which inhabit this Archetype */
  entities: Set<Entity>;
  /** Entities which have exited this archetype since last refresh */
  exited: Set<Entity>;
  /** The Archetype's unique ID */
  id: string;
  /** `true` if an entity has entered or left since last refresh */
  isDirty: boolean;
}

/** Add an entity to an archetype's inhabitants list */
export function addEntityToArchetype(entity: Entity): (archetype: Archetype) => Archetype {
  return function (archetype: Archetype): Archetype {
    const { entities, entered } = archetype;
    entities.add(entity);
    entered.add(entity);
    archetype.isDirty = true;
    return archetype;
  };
}

/** @returns an array of Entities which inhabit this Archetype */
export function getEntitiesFromArchetype(archetype: Archetype): IterableIterator<Entity> {
  const { entities } = archetype;
  return entities.values();
}

/** @returns `true` if the Entity inhabits this Archetype */
export function isEntityInArchetype(entity: Entity): (archetype: Archetype) => boolean {
  return function (archetype: Archetype): boolean {
    const { entities } = archetype;
    return entities.has(entity);
  };
}

/** Remove an entity from the inhabitants list */
export function removeEntityFromArchetype(entity: Entity): (archetype: Archetype) => Archetype {
  return function (archetype: Archetype): Archetype {
    const { entities, exited } = archetype;
    entities.delete(entity);
    exited.add(entity);
    archetype.isDirty = true;
    return archetype;
  };
}

function validateSpec(spec: ArchetypeSpec): Required<ArchetypeSpec> {
  if (!spec) throw new SyntaxError("Archetype: specification object required.");
  const { bitfield, id } = spec;
  if (!bitfield) throw new SyntaxError("Archetype: spec.bitfield is required.");
  return { bitfield, id: id || bitfield.toString() };
}

/** Archetypes are unique groupings of entities by components */
export function createArchetype(spec: ArchetypeSpec): Archetype {
  const { bitfield, id } = validateSpec(spec);

  const candidateCache: Map<QueryInstance, boolean> = new Map();
  const cloneCache: Map<ComponentInstance<unknown>, Archetype> = new Map();
  const entered: Set<Entity> = new Set();
  const entities: Set<Entity> = new Set();
  const exited: Set<Entity> = new Set();

  return {
    isDirty: true,
    bitfield,
    candidateCache,
    cloneCache,
    entered,
    entities,
    exited,
    id,
  };
}
