/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Entity } from "../entity.js";
import { SchemaStorage } from "./schema.js";

export type StorageProxy<T> = Record<keyof T, number> & { eid: Entity };

export function storageProxy<T>(storage: SchemaStorage<T>): StorageProxy<T> {
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
        },
      });
      return res;
    },
    Object.create(
      {},
      {
        eid: {
          get(): Entity {
            return entityId;
          },
          set(entity: Entity) {
            entityId = entity;
          },
        },
      },
    ) as StorageProxy<T>,
  );
}
