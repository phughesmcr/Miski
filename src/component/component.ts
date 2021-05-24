/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';
import { deepAssignObjects } from '../utils';
import { World } from '../world';

export interface ComponentSpec<T> {
  name: string;
  defaults: T;
}

export class Component<T> {
  private _world: World;
  readonly defaults: Readonly<T>;
  readonly id: bigint;
  readonly name: string;

  constructor(world: World, id: bigint, spec: ComponentSpec<T>) {
    const { name } = spec;

    this.id = id;
    this.name = name;
    this._world = world;

    this.defaults = deepAssignObjects({}, spec.defaults as Record<string, unknown>) as T;
    Object.keys(this.defaults).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      Object.defineProperty(this, key, Object.getOwnPropertyDescriptor(this.defaults, key)!);
    });
  }

  getEntities(): Entity[] {
    return this._world.getEntitiesByComponents(this);
  }

  isRegistered(): boolean {
    return this._world.isComponentRegistered(this);
  }
}
