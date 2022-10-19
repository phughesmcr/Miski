/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Entity } from "../world.js";
import type { Schema, SchemaStorage } from "./schema.js";

/**
 * A storage proxy is a convenience method
 * for setting entity's component properties
 * in a way which is type safe and
 * flips the `changed` property on the entity
 * at the expense of performance.
 * */
export type StorageProxy<T extends Schema<T>> = Record<keyof T, number> & { getEntity(): Entity, setEntity(entity: Entity): Entity };

export function storageProxy<T extends Schema<T>>(storage: SchemaStorage<T>, changed: Set<Entity>): StorageProxy<T> {
  if (!storage) throw new SyntaxError("Proxy can only be used on components, not tags.");

  /** The currently selected entity */
  let entityId: Entity = 0 as Entity;

  return Object.freeze(
    Object.keys(storage).reduce(
      (res, key) => {
        Object.defineProperty(res, key, {
          get() {
            return storage[key as keyof T][entityId];
          },
          set(value: number) {
            if (storage[key as keyof T][entityId] !== value) {
              changed.add(entityId);
              storage[key as keyof T][entityId] = value;
            }
          },
        });
        return res;
      },
      {
        getEntity(): Entity {
          return entityId;
        },
        setEntity(entity: Entity): Entity {
          if (entity == undefined) return entityId;
          entityId = entity;
          return entityId;
        },
      } as StorageProxy<T>,
    ),
  );
}
