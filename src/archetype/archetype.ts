// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';

export class Archetype {
  private _registry: Set<Entity>;
  readonly id: bigint;

  constructor(id: bigint, initialEntities: Entity[] = []) {
    this.id = id;
    this._registry = new Set(initialEntities);
  }

  addEntity(entity: Entity): void {
    this._registry.add(entity);
  }

  getEntities(): Entity[] {
    return [...this._registry];
  }

  isEmpty(): boolean {
    return this._registry.size === 0;
  }

  removeEntity(entity: Entity): void {
    this._registry.delete(entity);
  }
}
