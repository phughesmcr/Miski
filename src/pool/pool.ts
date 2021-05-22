// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { World } from '../world';

export interface PoolSpec<T> {
  create: (world: World) => T;
  destroy: (item: T) => void;
  initialSize: number;
  growthFactor: number;
  maxSize: number;
  world: World;
}

export interface Poolable<T> {
  next: T | null;
}

export class Pool<T extends Poolable<T>> {
  readonly initialSize: number;
  readonly growthFactor: number;
  readonly maxSize: number;

  private _create: (world: World) => T;
  private _destroy: (item: T) => void;
  private _firstAvailable: T | null;
  private _pool: T[];
  private _world: World;


  constructor(spec: PoolSpec<T>) {
    const { create, destroy, initialSize, growthFactor, maxSize, world } = spec;

    this.initialSize = initialSize;
    this.growthFactor = growthFactor;
    this.maxSize = maxSize;

    this._create = create;
    this._destroy = destroy;
    this._firstAvailable = null;
    this._pool = new Array(initialSize) as T[];
    this._world = world;

    this.add(initialSize);
  }

  add(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (this._pool.length >= this.maxSize) {
        throw new Error('The pool is full!');
      }
      const item = this._create(this._world);
      item.next = this._firstAvailable;
      this._firstAvailable = item;
      this._pool.push(item);
    }
  }

  clear(): void {
    this._pool.length = 0;
    this._firstAvailable = null;
    this.add(this.initialSize);
  }

  get(): T | null {
    if (!(this._firstAvailable)) this.add(this.initialSize * this.growthFactor);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entity = this._firstAvailable!;
    this._firstAvailable = entity.next;
    return entity;
  }

  release(item: T): void {
    this._destroy(item);
    item.next = this._firstAvailable;
    this._firstAvailable = item;
  }
}
