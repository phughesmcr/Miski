/**
 * @name        System
 * @description Systems provide the functionality for sets of archetypes
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { Entity } from "../entity/entity-manager";
import { Query } from "../query/query";

export interface System extends SystemPrototype {
  entities: Entity[];
  name: string;
  query: Query;
}

export interface SystemSpec {
  /** The associated query to gather entities for this system. */
  query: Query;
  /** The name of the system. Must be a valid property name. */
  name: string;
  /**
   * The system's pre-update function.
   * This runs once per step before the update function.
   * @param entities an array of entities associated with the system's query
   */
  pre?: (entities: Entity[]) => void;
  /**
   * The system's post-update function.
   * This runs once per step after the update function.
   * @param entities an array of entities associated with the system's query
   * @param alpha the step's interpolation alpha
   */
  post?: (entities: Entity[], alpha?: number) => void;
  /**
   * The system's update function.
   * @param entities an array of entities associated with the system's query
   * @param delta the step's delta time
   */
  update?: (entities: Entity[], delta?: number) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function noopPre(_entities: Entity[]): void {
  return;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function noopPost(_entities: Entity[], _alpha?: number): void {
  return;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function noopUpdate(_entities: Entity[], _delta?: number): void {
  return;
}

export interface SystemPrototype {
  disable: () => void;
  enable: () => void;
  enabled: boolean;
  isSystem: true;
  post: (entities: Entity[], alpha?: number) => void;
  pre: (entities: Entity[]) => void;
  update: (entities: Entity[], delta?: number) => void;
}

const System: SystemPrototype = Object.create(Object.prototype, {
  isSystem: {
    value: true,
    enumerable: true,
    configurable: false,
    writable: false,
  },
  enabled: {
    value: false,
    enumerable: true,
    configurable: false,
    writable: true,
  },
  disable: {
    value: function (this: System) {
      return this.enabled === false;
    },
    enumerable: true,
    configurable: false,
    writable: false,
  },
  enable: {
    value: function (this: System) {
      return this.enabled === true;
    },
    enumerable: true,
    configurable: false,
    writable: false,
  },
  pre: {
    value: noopPre,
    enumerable: true,
    configurable: false,
    writable: true,
  },
  post: {
    value: noopPost,
    enumerable: true,
    configurable: false,
    writable: true,
  },
  update: {
    value: noopUpdate,
    enumerable: true,
    configurable: false,
    writable: true,
  },
}) as SystemPrototype;

export function createSystem(spec: SystemSpec): System {
  const { name, query, pre, post, update } = spec;

  const system: System = Object.create(System, {
    name: {
      value: name,
      enumerable: true,
      configurable: false,
      writable: false,
    },
    query: {
      value: query,
      enumerable: true,
      configurable: false,
      writable: false,
    },
    entities: {
      get(this: System) {
        return this.query?.getEntities() ?? [];
      },
      enumerable: true,
      configurable: false,
    },
  }) as System;

  if (pre) system.pre = pre;
  if (post) system.post = post;
  if (update) system.update = update;

  return system;
}
