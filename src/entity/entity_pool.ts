// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { createEntity, Entity } from './entity';

export interface EntityPoolSpec {
  initialPoolSize: number;
  maxEntities: number;
}

export interface EntityPool {
  flush: () => void;
  get: () => Entity | null;
  release: (entity: Entity) => void;
}

/** Creates an entity object pool */
export function createPool(spec: EntityPoolSpec): EntityPool {
  const { initialPoolSize, maxEntities } = { ...spec };

  /** The pool itself */
  const _pool: Entity[] = [];

  /** The first available entity */
  let _firstAvailable: Entity | null;

  /** Creates a new entity object  */
  const _create = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      if (_pool.length >= maxEntities) {
        throw new Error('The entity pool is full.');
      }
      const entity = createEntity();
      entity.next(_firstAvailable);
      _firstAvailable = entity;
      _pool.push(entity);
    }
  };

  /** Empty the pool */
  const flush = (): void => {
    _pool.length = 0;
    _firstAvailable = null;
    _create(initialPoolSize);
  };

  /** Get an entity from the pool */
  const get = (): Entity | null => {
    if (!_firstAvailable) _create(initialPoolSize * 0.25);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entity = _firstAvailable!;
    _firstAvailable = entity.next();
    return entity;
  };

  /** Release an entity back into the pool */
  const release = (entity: Entity): void => {
    entity.purge();
    entity.next(_firstAvailable);
    _firstAvailable = entity;
  };

  // flush the pool before returning
  flush();

  return Object.freeze({
    flush,
    get,
    release,
  });
}