// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity, createEntity } from './entity';

export interface EntityPoolSpec {
  initialPoolSize: number;
  maxEntities: number;
}

export interface EntityPool {
  flush: () => void;
  get: () => Entity | null;
  release: (entity: Entity) => void;
}

export function createPool(spec: EntityPoolSpec): EntityPool {
  const { initialPoolSize, maxEntities } = { ...spec };

  const _pool: Entity[] = [];
  let _firstAvailable: Entity | null;

  const _create = (n = 1): void => {
    for (let i = n; i >= 0; i--) {
      if (_pool.length >= maxEntities) {
        throw new Error('The entity pool is full.');
      }
      const entity = createEntity();
      entity.next(_firstAvailable);
      _firstAvailable = entity;
      _pool.push(entity);
    }
  };

  const flush = (): void => {
    _pool.length = 0;
    _firstAvailable = null;
    _create(initialPoolSize);
  };

  const get = (): Entity | null => {
    if (!_firstAvailable) _create(initialPoolSize * 0.25);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entity = _firstAvailable!;
    _firstAvailable = entity.next();
    return entity;
  };

  const release = (entity: Entity): void => {
    entity.purge();
    entity.next(_firstAvailable);
    _firstAvailable = entity;
  };

  flush();

  return Object.freeze({
    flush,
    get,
    release,
  });
}