/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Entity } from "../entity.js";
import type { SchemaStorage } from "./schema.js";

export type StorageProxy<T> = Record<keyof T, number> & { eid: Entity };

export function storageProxy<T>(storage: SchemaStorage<T>, changed: Set<Entity>): StorageProxy<T> {
  if (!storage) throw new SyntaxError("Proxy can only be used on components, not tags.");

  let entityId: Entity = 0 as Entity;

  return Object.keys(storage).reduce(
    (res, key) => {
      Object.defineProperty(res, key, {
        get() {
          return storage[key as keyof T][entityId];
        },
        set(value: number) {
          storage[key as keyof T][entityId] = value;
          changed.add(entityId);
        },
      });
      return res;
    },
    {
      get eid(): Entity {
        return entityId;
      },
      set eid(entity: Entity) {
        entityId = entity;
      },
    } as StorageProxy<T>,
  );
}
