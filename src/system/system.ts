// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';
import { Query } from '../query/query';
import { Toggleable } from '../utils';
import { World } from '../world';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function noopPre(_entities: Entity[], _global: Entity): void { return; }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function noopPost(_entities: Entity[], _global: Entity, _int?: number): void { return; }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function noopUpdate(_entities: Entity[], _global: Entity, _dt?: number): void { return; }

export interface SystemSpec {
  /**
   * The associated query to gather entities for this system. @see world.registerQuery()
   * null queries will gather all entities in the world.
   */
  query?: Query | null;
  /** The name of the system. Must be a valid property name. */
  name: string;
  /**
   * The system's pre-update function.
   * This runs once per step before the update function.
   * @param entities an array of entities associated with the system's query
   * @param global the world's global entity
   */
  pre?: (entities: Entity[], global: Entity) => void;
  /**
   * The system's post-update function.
   * This runs once per step after the update function.
   * @param entities an array of entities associated with the system's query
   * @param global the world's global entity
   * @param int the step's interpolation alpha
   */
  post?: (entities: Entity[], global: Entity, int?: number) => void;
  /**
   * The system's update function.
   * @param entities an array of entities associated with the system's query
   * @param global the world's global entity
   * @param dt the step's delta time
   */
  update?: (entities: Entity[], global: Entity, dt?: number) => void;
}

export class System implements Toggleable {
  private _enabled: boolean;
  private _world: World;
  readonly name: string;
  readonly query: Query | null;
  readonly pre: (entities: Entity[], global: Entity) => void;
  readonly post: (entities: Entity[], global: Entity, int?: number) => void;
  readonly update: (entities: Entity[], global: Entity, dt?: number) => void;

  constructor(world: World, spec: SystemSpec) {
    const {
      name,
      query = null,
      pre = noopPre,
      post = noopPost,
      update = noopUpdate,
    } = spec;

    this.name = name;
    this.query = query;
    this.pre = pre;
    this.post = post;
    this.update = update;

    this._enabled = false;
    this._world = world;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get entities(): Entity[] {
    return (this.query === null) ? this._world.getEntities() : this.query.entities;
  }

  disable(): void {
    this._enabled = false;
  }

  enable(): void {
    this._enabled = true;
  }
}
