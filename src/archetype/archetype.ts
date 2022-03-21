/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Bitfield } from "../bitfield.js";
import type { ComponentInstance } from "../component/instance.js";
import { $_DIRTY } from "../constants.js";
import type { Entity } from "../entity.js";
import type { QueryInstance } from "../query/instance.js";

export interface ArchetypeSpec {
  /** The Archetype's Components as an id Bitfield */
  bitfield: Bitfield;
  /** Optional ID string. Will be generated if omitted */
  id?: string;
}

/** Archetypes are unique groupings of entities by components */
export interface Archetype {
  /** @private Provides a getter and setter for the `isDirty` flag */
  [$_DIRTY]: boolean;
  /** The Archetype's Component Bitfield */
  bitfield: Bitfield;
  /** */
  candidateCache: Map<QueryInstance, boolean>;
  /** */
  cloneCache: Map<ComponentInstance<unknown>, Archetype>;
  /** The components associated with this archetype */
  components: Set<ComponentInstance<unknown>>;
  /** Entities which have entered this archetype since last refresh */
  entered: Set<Entity>;
  /** Set of Entities which inhabit this Archetype */
  entities: Set<Entity>;
  /** Entities which have exited this archetype since last refresh */
  exited: Set<Entity>;
  /** The Archetype's unique ID */
  id: string;
  /** `true` if the object is in a dirty state */
  isDirty: boolean;
}

function validateSpec(spec: ArchetypeSpec): Required<ArchetypeSpec> {
  if (!spec) throw new SyntaxError("Archetype: specification object required.");
  const { bitfield, id } = spec;
  if (!bitfield) throw new SyntaxError("Archetype: spec.bitfield is required.");
  return { bitfield, id: id || bitfield.toString() };
}

export function createArchetype(spec: ArchetypeSpec): Archetype {
  const { bitfield, id } = validateSpec(spec);

  const candidateCache: Map<QueryInstance, boolean> = new Map();
  const cloneCache: Map<ComponentInstance<unknown>, Archetype> = new Map();
  const components: Set<ComponentInstance<unknown>> = new Set();
  const entered: Set<Entity> = new Set();
  const entities: Set<Entity> = new Set();
  const exited: Set<Entity> = new Set();

  let isDirty = true;

  return {
    get [$_DIRTY](): boolean {
      return isDirty;
    },
    set [$_DIRTY](dirty: boolean) {
      isDirty = !!dirty;
    },
    get isDirty(): boolean {
      return isDirty;
    },
    bitfield,
    candidateCache,
    cloneCache,
    components,
    entered,
    entities,
    exited,
    id,
  };
}
