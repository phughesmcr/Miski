/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../bitfield.js";
import { ComponentInstance } from "../component/instance.js";
import { Entity } from "../entity.js";
import { Archetype, createArchetype } from "./archetype.js";

export interface ArchetypeManagerSpec {
  bitfieldFactory: (components?: ComponentInstance<unknown>[] | undefined) => Bitfield;
  getEntityArchetype: (entity: number) => Archetype | undefined;
  setEntityArchetype: (entity: number, archetype: Archetype) => boolean;
}

export interface ArchetypeManager {
  archetypeMap: Map<string, Archetype>;
  updateArchetype: <T>(entity: Entity, component: ComponentInstance<T>) => Archetype;
}

export function createArchetypeManager(spec: ArchetypeManagerSpec): ArchetypeManager {
  const { bitfieldFactory, getEntityArchetype, setEntityArchetype } = spec;
  const archetypeMap: Map<string, Archetype> = new Map();

  return {
    archetypeMap,

    /**
     * Update an entity's archetype
     * @param entity the entity to update
     * @param component the component to toggle
     * @returns the entity's new archetype
     */
    updateArchetype<T>(entity: Entity, component: ComponentInstance<T>): Archetype {
      const previousArchetype = getEntityArchetype(entity);
      let nextArchetype: Archetype | undefined;
      if (previousArchetype) {
        previousArchetype.removeEntity(entity);
        const [id, factory] = previousArchetype.cloneInStep(component);
        if (archetypeMap.has(id)) {
          nextArchetype = archetypeMap.get(id)!;
        } else {
          nextArchetype = factory();
          archetypeMap.set(id, nextArchetype);
        }
      } else {
          nextArchetype = createArchetype({ bitfield: bitfieldFactory([component]) });
          archetypeMap.set(nextArchetype.id, nextArchetype);
      }
      nextArchetype.addEntity(entity);
      setEntityArchetype(entity, nextArchetype);
      return nextArchetype;
    },
  };
}
