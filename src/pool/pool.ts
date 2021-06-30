/**
 * @name        Pool
 * @description A generic object pool
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { World } from "../world";

export interface Pool<T> {
  add: (n?: number) => Pool<T>;
  acquire: () => T;
  clear: () => Pool<T>;
  release: (item: T) => Pool<T>;
}

export interface PoolSpec<T> {
  create: (...args: unknown[]) => T;
  destroy: (item: T) => void;
  initialSize: number;
  growthFactor: number;
  maxSize: number;
  world: World;
}

export interface Poolable<T> {
  next: T | null;
}

export function createPool<T extends Poolable<T>>(spec: PoolSpec<T>): Pool<T> {
  const { create, destroy, initialSize, growthFactor, maxSize } = spec;

  let _firstAvailable: T | null = null;
  const _pool = new Array(maxSize);

  const pool = Object.create(
    {},
    {
      add: {
        value: function (this: Pool<T>, n = 1): Pool<T> {
          if (n + _pool.length >= maxSize) {
            throw new Error(`Adding ${n} items takes the pool over capacity!`);
          }
          for (let i = 0; i < n; i++) {
            const item = create();
            item.next = _firstAvailable;
            _firstAvailable = item;
            _pool.push(item);
          }
          return this;
        },
        configurable: false,
        enumerable: true,
        writable: false,
      },
      acquire: {
        value: function (this: Pool<T>): T {
          if (!_firstAvailable) this.add(initialSize * growthFactor);
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const item = _firstAvailable!;
          _firstAvailable = item.next;
          return item;
        },
        configurable: false,
        enumerable: true,
        writable: false,
      },
      clear: {
        value: function (this: Pool<T>): Pool<T> {
          _pool.length = 0;
          _firstAvailable = null;
          this.add(initialSize);
          return this;
        },
        configurable: false,
        enumerable: true,
        writable: false,
      },
      release: {
        value: function (this: Pool<T>, item: T): Pool<T> {
          destroy(item);
          item.next = _firstAvailable;
          _firstAvailable = item;
          return this;
        },
        configurable: false,
        enumerable: true,
        writable: false,
      },
    }
  ) as Pool<T>;

  pool.add(initialSize);

  return pool;
}
