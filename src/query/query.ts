// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
// Based heavily on Geotic's queries (@see https://github.com/ddmills/geotic). MIT license.
"use strict";

import { Component } from '../component/component';
import { Entity } from '../entity/entity';
import { Mask } from '../mask/mask';
import { World } from '../world';

export interface QuerySpec {
  /** Gather entities as long as they have all these components */
  all?: Component<unknown>[],
  /** Gather entities as long as they have one of more of these components */
  any?: Component<unknown>[],
  /** Gather entities as long as they don't have these components */
  none?: Component<unknown>[],
}

function maskFromComponents(components: Component<unknown>[]): Mask {
  return components.reduce((mask, current) => {
    mask.on(current.id);
    return mask;
  }, new Mask()) ?? new Mask();
}

export class Query {
  private _mskAll: bigint;
  private _mskAny: bigint;
  private _mskNone: bigint;
  private _registry: Set<Entity>;
  private _world: World;

  constructor(world: World, spec: QuerySpec) {
    const {
      all = [],
      any = [],
      none = [],
    } = spec;

    this._mskAll = maskFromComponents(all).value;
    this._mskAny = maskFromComponents(any).value;
    this._mskNone = maskFromComponents(none).value;

    this._registry = new Set();
    this._world = world;
  }

  get size(): number {
    return this._registry.size;
  }

  getEntities(): Entity[] {
    return [...this._registry];
  }

  hasEntity(entity: Entity): boolean {
    return this._registry.has(entity);
  }

  matches(archetype: bigint): boolean {
    const _any = this._mskAny === 0n || (archetype & this._mskAny) > 0;
    const _all = (archetype & this._mskAll) === this._mskAll;
    const _none = (archetype & this._mskNone) === 0n;
    return _any && _all && _none;
  }

  update(): void {
    this._registry.clear();
    this._world.getArchetypes().forEach(([id, archetype]) => {
      if (this.matches(id)) archetype.forEach((entity) => this._registry.add(entity));
    });
  }
}
