/**
 * @name        Archetype
 * @description Archetypes are unique groups of components
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { Entity } from "../entity/entity-manager";
import { Bitmask } from "../utils/bitmasks";

export const $dirty = Symbol();

export interface ArchetypeSpec {
  mask: Bitmask;
}

export interface Archetype {
  [$dirty]: boolean;
  add: (entity: Entity) => Archetype;
  entities: Set<Entity>;
  has: (entity: Entity) => boolean;
  mask: Bitmask;
  name: string;
  remove: (entity: Entity) => Archetype;
  reset: () => Archetype;
}

const ArchetypeProto = {
  add: function (this: Archetype, entity: Entity): Archetype {
    if (this.has(entity)) return this;
    this.entities.add(entity);
    this[$dirty] = true;
    return this;
  },
  has: function (this: Archetype, entity: Entity): boolean {
    return this.entities.has(entity);
  },
  remove: function (this: Archetype, entity: Entity): Archetype {
    if (!this.has(entity)) return this;
    this.entities.delete(entity);
    this[$dirty] = true;
    return this;
  },
  reset: function (this: Archetype): Archetype {
    this.entities.clear();
    this[$dirty] = true;
    return this;
  },
};

export function createArchetype(mask: Bitmask): Archetype {
  return Object.create(ArchetypeProto, {
    [$dirty]: {
      value: true,
      configurable: false,
      enumerable: true,
      writable: true,
    },
    entities: {
      value: new Set(),
      configurable: false,
      enumerable: true,
      writable: false,
    },
    mask: {
      value: mask,
      configurable: false,
      enumerable: true,
      writable: false,
    },
    name: {
      value: mask.toString(),
      configurable: false,
      enumerable: true,
      writable: false,
    },
  }) as Archetype;
}
