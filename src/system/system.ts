// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';
import { Query } from '../query/query-manager';
import { Toggleable } from '../utils';
import { World } from '../world';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function noopPre(_entities: Entity[]): void { return; }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function noopPost(_entities: Entity[], _int?: number): void { return; }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function noopUpdate(_entities: Entity[], _dt?: number): void { return; }

export interface SystemSpec {
  /**
   * The associated query to gather entities for this system. @see world.registerQuery()
   * undefined queries will gather all entities in the world.
   */
  query?: Query;
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
   * @param int the step's interpolation alpha
   */
  post?: (entities: Entity[], int?: number) => void;
  /**
   * The system's update function.
   * @param entities an array of entities associated with the system's query
   * @param dt the step's delta time
   */
  update?: (entities: Entity[], dt?: number) => void;
}

export class System implements Toggleable {
  private _enabled: boolean;
  private _world: World;
  readonly name: string;
  readonly pre: (entities: Entity[]) => void;
  readonly post: (entities: Entity[], int?: number) => void;
  readonly update: (entities: Entity[], dt?: number) => void;

  constructor(world: World, spec: SystemSpec) {
    const {
      name,
      query = undefined,
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
    return this._world.getEntities(this.query);
  }

  disable(): void {
    this._enabled = false;
  }

  enable(): void {
    this._enabled = true;
  }
}
