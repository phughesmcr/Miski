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

    this._all = new Set(spec.all);
    this._any = new Set(spec.any);
    this._none = new Set(spec.none);

    this._mskAll = new Mask();
    this._mskAny = new Mask();
    this._mskNone = new Mask();

    this._refresh();
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
    const _any = this._mskAny.value === 0n || bitIntersection(archetype, this._mskAny.value) > 0;
    const _all = bitIntersection(archetype, this._mskAll.value) === this._mskAll.value;
    const _none = bitIntersection(archetype, this._mskNone.value) === 0n;
    return _any && _all && _none;
  }

  private _refresh(): void {
    this._all.forEach((component) => {
      this._mskAll.on(component.id);
      if (component.isRegistered() === false) {
        console.warn(`Query has unregistered component ("${component.id}") in _all.`, this);
      }
    });
    this._any.forEach((component) => {
      this._mskAny.on(component.id);
      if (component.isRegistered() === true) {
        console.warn(`Query has unregistered component ("${component.id}") in _any.`, this);
      }
    });
    this._none.forEach((component) => {
      this._mskNone.on(component.id);
      if (component.isRegistered() === true) {
        console.warn(`Query has unregistered component ("${component.id}") in _none.`, this);
      }
    });
  }

  update(): void {
    this._refresh();
    this._registry.clear();
    this._world.getArchetypes().forEach((archetype: Archetype) => {
      if (this.matches(archetype.id)) {
        archetype.getEntities().forEach((entity) => this._registry.add(entity));
      }
    });
  }
}
