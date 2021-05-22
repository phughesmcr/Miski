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
  query?: Query | null;
  name: string;
  pre?: (entities: Entity[], global: Entity) => void;
  post?: (entities: Entity[], global: Entity, int?: number) => void;
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
