/**
 * @name        Query
 * @description Queries group Archetypes
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { World } from "..";
import { Archetype } from "../archetype/archetype";
import { ComponentInstance } from "../component/component";
import { componentsToMask } from "../component/component-manager";
import { Entity } from "../entity/entity-manager";

export type QueryArray = [all: Uint32Array, any: Uint32Array, none: Uint32Array];

export type QueryRegistry = Query[];

export interface QuerySpec {
  /** Makes finding the query later much easier */
  name: string;
  /** The world associated with the query */
  world: World;
  /** AND - Gather entities as long as they have all these components */
  all?: ComponentInstance<unknown>[];
  /** OR - Gather entities as long as they have 0...* of these components */
  any?: ComponentInstance<unknown>[];
  /** NOT -Gather entities as long as they don't have these components */
  none?: ComponentInstance<unknown>[];
}

function isMatch(query: QueryArray, archetype: Archetype): boolean {
  const { mask } = archetype;
  if (!mask) return false;

  const _and = query[0];
  const _or = query[1];
  const _not = query[2];

  // NOT
  for (let i = 0, n = _not.length; i < n; i++) {
    if ((_not[i] & mask[i]) !== 0) {
      return false;
    }
  }
  // AND
  for (let i = 0, n = _and.length; i < n; i++) {
    if ((_and[i] & mask[i]) !== mask[i]) {
      return false;
    }
  }
  // OR
  for (let i = 0, n = _or.length; i < n; i++) {
    if ((_or[i] & mask[i]) > 0) {
      return false;
    }
  }

  return true;
}

export interface Query {
  add: (archetype: Archetype) => Query;
  archetypes: Archetype[];
  getEntities: () => Entity[];
  isMatch: (archetype: Archetype) => boolean;
  isQuery: true;
  name: string;
  query: QueryArray;
  remove: (archetype: Archetype) => Query;
}

const QueryProto: Query = Object.create(Object.prototype, {
  add: {
    value: function (this: Query, archetype: Archetype): Query {
      if (this.archetypes.includes(archetype)) return this;
      this.archetypes.push(archetype);
      return this;
    },
    configurable: false,
    enumerable: true,
    writable: false,
  },
  getEntities: {
    /** @todo cache entities on .add() and then check for dirty and only update those ? */
    value: function (this: Query): Entity[] {
      if (!Object.keys(this.archetypes)?.length) {
        return [];
      }
      const sets = Object.values(this.archetypes).flatMap((archetype) => [...archetype.entities]);
      return [...new Set(sets)];
    },
    configurable: false,
    enumerable: true,
    writable: false,
  },
  isMatch: {
    value: function (this: Query, archetype: Archetype): boolean {
      if (!this.query || !archetype) return false;
      const match = isMatch(this.query, archetype);
      if (match) {
        this.add(archetype);
      } else {
        /** @todo would this scenario ever happen?? */
        // this.remove(archetype);
      }
      return match;
    },
    configurable: false,
    enumerable: true,
    writable: false,
  },
  isQuery: {
    value: true,
    configurable: false,
    enumerable: true,
    writable: false,
  },
  remove: {
    value: function (this: Query, archetype: Archetype) {
      if (!this.archetypes.includes(archetype)) return this;
      this.archetypes.splice(this.archetypes.indexOf(archetype), 1);
      return this;
    },
    configurable: false,
    enumerable: true,
    writable: false,
  },
}) as Query;

export function createQuery(world: World, spec: QuerySpec): Query {
  const { all = [], any = [], none = [], name } = spec;

  /** @todo allow Component<T> & strings in arrays */
  const isAllValid = all.every((component) => component.id !== undefined);
  const isAnyValid = any.every((component) => component.id !== undefined);
  const isNoneValid = none.every((component) => component.id !== undefined);
  if (!isAllValid || !isAnyValid || !isNoneValid) {
    throw new TypeError("createQuery: query spec must contain component instances only, not components or strings.");
  }

  const _AND = componentsToMask(world, ...all);
  const _OR = componentsToMask(world, ...any);
  const _NOT = componentsToMask(world, ...none);

  return Object.create(QueryProto, {
    archetypes: {
      value: [],
      configurable: false,
      enumerable: true,
      writable: false,
    },
    name: {
      value: name,
      configurable: false,
      enumerable: true,
      writable: false,
    },
    query: {
      value: [_AND, _OR, _NOT],
      configurable: false,
      enumerable: true,
      writable: false,
    },
  }) as Query;
}
