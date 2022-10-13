/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype.js";
import type { Query } from "../query/query.js";
import type { QueryInstance } from "../query/instance.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { Entity } from "../entity.js";

export interface ArchetypeManagerSpec {
  capacity: number;
  components: Component<any>[];
}

export class ArchetypeManager {
  /** Map<Archetype.id, Archetype> */
  archetypeMap: Map<string, Archetype> = new Map();
  /** Archetype's indexed by Entity */
  entityArchetypes: Archetype[];
  /** The root/empty archetype */
  rootArchetype: Archetype;

  constructor(spec: ArchetypeManagerSpec) {
    const { capacity, components } = spec;
    this.archetypeMap = new Map();
    this.entityArchetypes = new Array(capacity) as Archetype[];
    this.rootArchetype = new Archetype(components.length);
  }

  export(): Record<string, Entity[]> {
    return [...this.archetypeMap].reduce((res, [id, archetype]) => {
      res[id] = [...archetype.entities];
      return res;
    }, {} as Record<string, Entity[]>);
  }

  getEntityArchetype(entity: Entity): Archetype | undefined {
    return this.entityArchetypes[entity];
  }

  removeEntityArchetype(entity: Entity): ArchetypeManager {
    this.entityArchetypes[entity]?.removeEntity(entity);
    this.entityArchetypes[entity] = this.rootArchetype.addEntity(entity);
    return this;
  }

  refreshArchetypes(queries: Map<Query, QueryInstance>): ArchetypeManager {
    /** @todo double loop isn't ideal */
    this.archetypeMap.forEach((archetype) => {
      queries.forEach((query) => {
        // this was other way around last time
        if (!query.archetypes.has(archetype) && archetype.isCandidate(query)) {
          query.isDirty = true;
          query.archetypes.add(archetype);
        }
      });
      archetype.refresh();
    });
    return this;
  }

  setEntityArchetype(entity: Entity, archetype: Archetype): ArchetypeManager {
    if (this.entityArchetypes[entity] === archetype) return this;
    this.entityArchetypes[entity]?.removeEntity(entity);
    this.entityArchetypes[entity] = archetype.addEntity(entity);
    this.archetypeMap.set(archetype.id, archetype);
    return this;
  }

  /**
   * Update an Entity's archetype
   * @param entity the entity to update
   * @param components the components to toggle
   * @returns The entity's resulting archetype
   */
  updateArchetype(entity: Entity, components: ComponentInstance<any>[]): Archetype {
    const previousArchetype = this.entityArchetypes[entity];
    previousArchetype?.removeEntity(entity);
    const bitfield = previousArchetype
      ? previousArchetype.bitfield.cloneWithToggle(components)
      : this.rootArchetype.bitfield.cloneWithToggle(components);
    const id = bitfield.toString();
    const nextArchetype = this.archetypeMap.get(id) ?? new Archetype(this.rootArchetype.bitfield.length, components, bitfield);
    if (!this.archetypeMap.has(id)) this.archetypeMap.set(id, nextArchetype);
    this.entityArchetypes[entity] = nextArchetype.addEntity(entity);
    return nextArchetype;
  }
}
