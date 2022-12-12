/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Entity } from "../world.js";
import type { Schema, SchemaStorage } from "./schema.js";

/**
 * A storage proxy is a convenience method for setting entity's component
 * properties in a way which is type safe and flips the `changed` property
 * on the entity at the expense of performance vs. direct array access.
 */
export type StorageProxy<T extends Schema<T>> = Record<keyof T, number> & {
  /** @returns the entity the proxy is currently pointed at */
  getEntity(): Entity;
  /**
   * Change the proxy's cursor to a given entity
   * @param entity The entity to change
   * @throws If the entity is not a number
   */
  setEntity(entity: Entity): Entity;
};

/**
 * @internal
 * Create a new storage proxy object for a component instance
 * @param storage The component's storage object
 * @param changed The component's changed entity set
 * @returns A new storage proxy object
 * @throws if no storage or changed set are provided
 */
export function storageProxy<T extends Schema<T>>(storage: SchemaStorage<T>, changed: Set<Entity>): StorageProxy<T> {
  if (!storage) throw new SyntaxError("Proxy can only be used on components, not tags.");
  if (!changed) throw new SyntaxError("Proxy requires a changed set.");

  /** The currently selected entity */
  let entityId: Entity = 0 as Entity;

  return Object.freeze(
    // Create a getter and setter for each storage property
    Object.keys(storage).reduce(
      (res, key) => {
        Object.defineProperty(res, key, {
          get() {
            return storage[key as keyof T][entityId];
          },
          set(value: number) {
            if (storage[key as keyof T][entityId] !== value) {
              storage[key as keyof T][entityId] = value;
              changed.add(entityId);
            }
          },
        });
        return res;
      },
      // allow the user to control which entity the proxy should modify
      {
        getEntity(): Entity {
          return entityId;
        },
        setEntity(entity: Entity): Entity {
          if (isNaN(entity)) throw new TypeError("Expected entity to be a number.");
          entityId = entity;
          return entityId;
        },
      } as StorageProxy<T>,
    ),
  );
}
