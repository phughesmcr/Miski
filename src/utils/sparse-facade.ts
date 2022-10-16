/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { BitPool } from "./bitpool.js";
import type { TypedArray } from "./utils.js";
import type { Entity } from "../entity.js";

/**
 * @param dense the typed array to apply the facade to
 * @returns A proxy to the dense array
 */
export function sparseFacade<T extends TypedArray>(dense: T): T {
  /** Map<Entity, Dense Array Index> */
  const sparse: Map<Entity, number> = new Map();

  /** Array of available indexes in dense */
  const available = new BitPool(dense.length);

  /** @returns the entity's value from the dense array or undefined if non-existant */
  const _get = (entity: Entity) => dense[sparse.get(entity) ?? -1];

  /** @returns `false` if dense array is full, `true` if value set successfully */
  const _set = (entity: Entity, value: T[0]): boolean => {
    const idx = sparse.get(entity) ?? available.acquire();
    if (idx === undefined) return false;
    dense[idx] = value;
    sparse.set(entity, idx);
    return true;
  };

  /** @returns `false` if the entity isn't already stored, `true` if deleted successfully */
  const _deleteProperty = (entity: Entity): boolean => {
    const idx = sparse.get(entity);
    if (idx === undefined) return false;
    dense[idx] = 0;
    sparse.delete(entity);
    available.release(idx);
    return true;
  };

  return new Proxy(dense, {
    get: (_target: T, key: string | symbol) => _get(key as unknown as Entity),
    set: (_target: T, key: string | symbol, value: T[0]) => _set(key as unknown as Entity, value),
    deleteProperty: (_target: T, key: string | symbol) => _deleteProperty(key as unknown as Entity),
  });
}
