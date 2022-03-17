/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { EMPTY_SYMBOL } from "../constants.js";
import { Entity } from "../entity.js";
import { createAvailabilityArray, TypedArray } from "./utils.js";

/**
 * @param dense the typed array to apply the facade to
 * @returns A proxy to the dense array
 */
export function sparseFacade<T extends TypedArray>(dense: T): T {
  /** Map<Entity, Dense Array Index> */
  const sparse: Map<Entity, number> = new Map();

  /** Array of available indexes in dense */
  const available = createAvailabilityArray(dense.length);

  /** @returns the entity's value from the dense array or undefined if non-existant */
  const getter = (entity: Entity) => dense[sparse.get(entity) ?? (EMPTY_SYMBOL as unknown as number)];

  /** @returns `false` if dense array is full, `true` if value set successfully */
  const set = (entity: Entity, value: T[0]): boolean => {
    const idx = sparse.get(entity) ?? available.pop();
    if (idx === undefined) return false;
    dense[idx] = value;
    sparse.set(entity, idx);
    return true;
  };

  /** @returns `false` if the entity isn't already stored, `true` if deleted successfully */
  const remove = (entity: Entity): boolean => {
    const idx = sparse.get(entity);
    if (idx === undefined) return false;
    dense[idx] = 0;
    sparse.delete(entity);
    available.push(idx);
    return true;
  };

  return new Proxy(dense, {
    get: (_target: T, key: string | symbol) => getter(key as unknown as Entity),
    set: (_target: T, key: string | symbol, value: T[0]) => set(key as unknown as Entity, value),
    deleteProperty: (_target: T, key: string | symbol) => remove(key as unknown as Entity),
  });
}
