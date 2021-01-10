// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

export interface PoolSpec<T> {
  initialSize?: number | bigint,
  create: (() => T),
  destroy: ((obj: T) => T),
}

export interface Pool<T> {
  get(): T,
  release(obj: T): void,
}

export function _createPool<T>(spec: PoolSpec<T>): Pool<T> {
  const {
    initialSize = 2,
    create,
    destroy
  } = spec;

  const pool = [] as T[];

  // populate pool to initial size
  for (let i = 0; i < initialSize; i++) {
    pool.push(create());
  }

  const get = function(): T {
    if (pool.length > 0) {
      return pool.pop()!;
    } else {
      return create();
    }
  };

  const release = function(obj: T): void {
    pool.push(destroy(obj));
  };

  return Object.freeze({
    get,
    release,
  });
}