/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import * as bitfield from "../bits/bitfield.js";
import type { Component } from "../component/component.js";
import type { ComponentInstance } from "../component/instance.js";
import type { QueryInstance } from "../query/instance.js";
import type { Query } from "../query/query.js";
import type { Entity } from "../world.js";
import { Archetype } from "./archetype.js";

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
    this.entityArchetypes = Array.from({ length: capacity }, (_, i) => this.rootArchetype.addEntity(i as Entity));
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
    for (const archetype of this.archetypeMap.values()) {
      if (!archetype.isEmpty) {
        for (const inst of queries.values()) {
          if (!inst.archetypes.has(archetype) && archetype.isCandidate(inst)) {
            inst.isDirty = true;
            inst.archetypes.add(archetype);
          }
        }
      }
      archetype.refresh();
    }
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
    previousArchetype?.removeEntity(entity);
    const field = previousArchetype?.bitfield
      ? bitfield.cloneWithToggle(previousArchetype.bitfield, "id", components)
      : bitfield.fromObjects(bitfield.getSize(this.rootArchetype.bitfield), "id", components);
    const id = field.toString();
    let nextArchetype = this.archetypeMap.get(id);
    if (!nextArchetype) {
      nextArchetype = new Archetype(bitfield.getSize(this.rootArchetype.bitfield), components, field);
      this.archetypeMap.set(id, nextArchetype);
    }
    this.entityArchetypes[entity] = nextArchetype.addEntity(entity);
    return nextArchetype;
  }
}
