// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
// Based heavily on Geotic's queries (@see https://github.com/ddmills/geotic). MIT license.
"use strict";

import { Archetype } from '../archetype/archetype';
import { Component } from '../component/component';
import { Entity } from '../entity/entity';
import { Mask } from '../mask/mask';
import { bitIntersection } from '../utils';
import { World } from '../world';

export interface QuerySpec {
  /** Gather entities as long as they have all these components */
  all?: Component<unknown>[],
  /** Gather entities as long as they have one of more of these components */
  any?: Component<unknown>[],
  /** Gather entities as long as they don't have these components */
  none?: Component<unknown>[],
}

export class Query {
  private _all: Set<Component<unknown>>;
  private _any: Set<Component<unknown>>;
  private _none: Set<Component<unknown>>;

  private _mskAll: Mask;
  private _mskAny: Mask;
  private _mskNone: Mask;

  private _registry: Set<Entity>;
  private _world: World;

  constructor(world: World, spec: QuerySpec) {
    this._registry = new Set();
    this._world = world;

    this._all = new Set();
    this._any = new Set();
    this._none = new Set();

    // create masks
    this._mskAll = spec.all?.reduce((mask, component) => {
      this._all.add(component);
      mask.on(component.id);
      return mask;
    }, new Mask()) ?? new Mask();
    this._mskAny = spec.any?.reduce((mask, component) => {
      this._any.add(component);
      mask.on(component.id);
      return mask;
    }, new Mask()) ?? new Mask();
    this._mskNone = spec.none?.reduce((mask, component) => {
      this._none.add(component);
      mask.on(component.id);
      return mask;
    }, new Mask()) ?? new Mask();
  }

  get entities(): Entity[] {
    return [...this._registry];
  }

  get size(): number {
    return this._registry.size;
  }

  hasEntity(entity: Entity): boolean {
    return this._registry.has(entity);
  }

  matches(archetype: bigint): boolean {
    const _any = this._mskAny.value === 0n || bitIntersection(archetype, this._mskAny.value) > 0;
    const _all = bitIntersection(archetype, this._mskAll.value) === this._mskAll.value;
    const _none = bitIntersection(archetype, this._mskNone.value) === 0n;
    return _any && _all && _none;
  }

  update(): void {
    this._registry.clear();
    this._world.getArchetypes().forEach((archetype: Archetype) => {
      if (this.matches(archetype.id)) {
        archetype.entities.forEach((entity) => this._registry.add(entity));
      }
    });
  }
}
