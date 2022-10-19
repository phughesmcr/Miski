/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype.js";
import type { Query } from "../query/query.js";
import type { Bitfield } from "../utils/bitfield.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { Entity } from "../world.js";
import type { QueryInstance } from "../query/instance.js";

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
    this.rootArchetype = new Archetype(components.length, []);
    this.archetypeMap = new Map();
    this.archetypeMap.set(this.rootArchetype.id, this.rootArchetype);
    this.entityArchetypes = new Array(capacity).map((_, i) => this.rootArchetype.addEntity(i as Entity));
  }

  /** @returns an entity's archetype or undefined if not found */
  getArchetype(entity: Entity): Archetype | undefined {
    return this.entityArchetypes[entity];
  }

  /** Returns an entity to the root archetype */
  resetArchetype(entity: Entity): ArchetypeManager {
    if (this.entityArchetypes[entity] === this.rootArchetype) return this;
    this.entityArchetypes[entity]?.removeEntity(entity);
    this.entityArchetypes[entity] = this.rootArchetype.addEntity(entity);
    return this;
  }

  /** Performs various archetype maintenance */
  refreshArchetypes(queries: Map<Query, QueryInstance>): ArchetypeManager {
    /** @todo double loop isn't ideal */
    this.archetypeMap.forEach((archetype) => {
      queries.forEach((query) => {
        if (!query.archetypes.has(archetype) && archetype.isCandidate(query)) {
          query.isDirty = true;
          query.archetypes.add(archetype);
        }
      });
      archetype.refresh();
    });
    return this;
  }

  /** Replace an entity's archetype */
  setArchetype(entity: Entity, archetype: Archetype): ArchetypeManager {
    if (!this.archetypeMap.has(archetype.id)) throw new Error("Invalid archetype.");
    if (this.entityArchetypes[entity] === archetype) return this;
    this.entityArchetypes[entity]?.removeEntity(entity);
    this.entityArchetypes[entity] = archetype.addEntity(entity);
    return this;
  }

  /**
   * Update an Entity's archetype
   * @param entity the entity to update
   * @param components the components to toggle
   * @returns The entity's resulting archetype
   */
  updateArchetype(entity: Entity, components: ComponentInstance<any>[]): Archetype {
    /** @todo replace this with a graph */
    const previousArchetype = this.entityArchetypes[entity];

    let bitfield: Bitfield;
    if (previousArchetype) {
      previousArchetype.removeEntity(entity);
      bitfield = previousArchetype.bitfield.cloneWithToggle("id", components);
    } else {
      bitfield = this.rootArchetype.bitfield.cloneWithToggle("id", components);
    }

    const id = bitfield.toString();
    let nextArchetype = this.archetypeMap.get(id);

    if (!nextArchetype) {
      nextArchetype = new Archetype(this.rootArchetype.bitfield.size, components, bitfield);
      this.archetypeMap.set(id, nextArchetype);
    }

    this.entityArchetypes[entity] = nextArchetype.addEntity(entity);
    return nextArchetype;
  }
}
