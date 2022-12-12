/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "../utils/bitfield.js";
import type { ComponentInstance } from "../component/instance.js";
import type { Entity } from "../world.js";
import type { QueryInstance } from "../query/instance.js";

export class Archetype {
  /** The Archetype's Component Bitfield */
  readonly bitfield: Bitfield;
  /** QueryInstances and their candidacy status*/
  readonly candidateCache: Map<QueryInstance, boolean>;
  /** The components associated with this archetype */
  readonly components: ComponentInstance<any>[];
  /** Entities which have entered this archetype since last refresh */
  readonly entered: Set<Entity>;
  /** Set of Entities which inhabit this Archetype */
  readonly entities: Set<Entity>;
  /** Entities which have exited this archetype since last refresh */
  readonly exited: Set<Entity>;
  /** `true` if the object is in a dirty state */
  isDirty: boolean;

  constructor(size: number, components: ComponentInstance<any>[], bitfield?: Bitfield) {
    this.bitfield = bitfield ?? Bitfield.fromObjects(size, "id", components);
    this.candidateCache = new Map();
    this.components = components;
    this.entered = new Set();
    this.entities = new Set();
    this.exited = new Set();
    this.isDirty = true;
  }

  /** The Archetype's unique identifier */
  get id(): string {
    return this.bitfield.toString();
  }

  /** `true` if this Archetype has no entities associated with it */
  get isEmpty(): boolean {
    return this.entities.size === 0;
  }

  /** The number of entities in the archetype */
  get size(): number {
    return this.entities.size;
  }

  /** Add an Entity to the Archetype */
  addEntity(entity: Entity): Archetype {
    this.entities.add(entity);
    this.entered.add(entity);
    this.isDirty = true;
    return this;
  }

  /** Create a new Archetype from this Archetype */
  clone(): Archetype {
    return new Archetype(this.bitfield.length, this.components, this.bitfield.clone());
  }

  /**
   * Test this Archetype matches a given QueryInstance
   * @param query The QueryInstance to test
   * @returns `true` if the QueryInstance is a match
   */
  isCandidate(query: QueryInstance): boolean {
    const cached = this.candidateCache.get(query);
    if (cached !== undefined) return cached;
    const status = this.bitfield.every(query.checkCandidacy);
    this.candidateCache.set(query, status);
    return status;
  }

  /** Clear entered/exited entities and set `isDirty` to `false` */
  refresh(): Archetype {
    this.entered.clear();
    this.exited.clear();
    this.isDirty = false;
    return this;
  }

  /** Remove an Entity from the Archetype */
  removeEntity(entity: Entity): Archetype {
    this.entities.delete(entity);
    this.exited.add(entity);
    this.isDirty = true;
    return this;
  }

  /** Serialize the Archetype to a string */
  toString(): string {
    return `
{
  bitfield: ${this.bitfield.toString()},
  components: ${this.components.map((inst) => inst.id).join(",")},
  entities: ${[...this.entities.values()].join(",")},
},
    `;
  }
}
