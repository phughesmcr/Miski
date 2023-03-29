/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { $_CHANGED, $_OWNERS } from "../constants.js";
import { bitfield, type Bitfield } from "../utils/bits/index.js";
import type { TypedArray } from "../utils/utils.js";
import { isObject, isPositiveInt, isUint32 } from "../utils/utils.js";
import type { Entity } from "../world.js";
import type { Component } from "./component.js";
import type { StorageProxy } from "./proxy.js";
import { storageProxy } from "./proxy.js";
import type { Schema, SchemaStorage } from "./schema.js";

interface ComponentInstanceSpec<T extends Schema<T>> {
  /** The world's entity capacity */
  capacity: number;
  /** The component to instantiate */
  component: Component<T>;
  /** The component instance's identifier */
  id: number;
  /** The component's TypedArray storage object */
  storage?: SchemaStorage<T> | undefined;
}

export type ComponentInstance<T extends Schema<T>> = Component<T> &
  Record<keyof T, TypedArray> & {
    /** @internal */
    [$_CHANGED]: Set<Entity>;
    /** @internal */
    [$_OWNERS]: Bitfield;
    /** Entities who's properties have been changed via this.proxy since last refresh */
    changed: IterableIterator<Entity>;
    /** The number of entities which have this component instance */
    count: number;
    /** The instance's identifier */
    id: number;
    /** */
    proxy: StorageProxy<T>;
  };

/**
 * Perform routine maintenance on a component instance
 * @param instance The ComponentInstance to refresh
 * @returns The ComponentInstance
 */
export function refreshComponentInstance<T extends Schema<T>>(instance: ComponentInstance<T>): ComponentInstance<T> {
  instance[$_CHANGED].clear();
  return instance;
}

/**
 * Create a new ComponentInstance.
 * A ComponentInstance is a Component tied to a World with storage
 * @param spec The ComponentInstance's specification object
 * @param spec.component The component to instantiate
 * @param spec.id The component instance's identifier
 * @param spec.storage The component's TypedArray storage object
 * @throws {SyntaxError|TypeError} on invalid spec properties.
 */
export function createComponentInstance<T extends Schema<T>>(
  spec: ComponentInstanceSpec<T>,
): Readonly<ComponentInstance<T>> {
  const { capacity, component, id, storage } = spec;
  if (!isPositiveInt(capacity)) throw new SyntaxError("Capacity must be integer > 0.");
  if (!component) throw new TypeError("Component instantiation requires as component!");
  if (!isUint32(id)) throw new SyntaxError("Component ID is invalid.");
  if (storage && !isObject(storage)) throw new TypeError("Component storage is malformed.");

  const changed: Set<Entity> = new Set();
  const owners: Bitfield = bitfield.create(capacity);

  const instance = Object.create(component, {
    [$_CHANGED]: {
      value: changed,
      configurable: false,
      enumerable: false,
      writable: false,
    },
    [$_OWNERS]: {
      value: owners,
      configurable: false,
      enumerable: false,
      writable: false,
    },
    changed: {
      get() {
        return changed.values();
      },
    },
    count: {
      get() {
        return bitfield.getPopulationCount(owners);
      },
    },
    id: {
      value: id,
      configurable: false,
      enumerable: true,
      writable: false,
    },
  }) as ComponentInstance<T>;

  if (storage) {
    // create instance.proxy
    Object.defineProperty(instance, "proxy", {
      value: storageProxy(storage, changed),
      configurable: false,
      enumerable: true,
      writable: false,
    });

    // assign raw storage
    Object.keys(storage).forEach((k) => {
      Object.defineProperty(instance, k, {
        value: storage[k as keyof T],
      });
    });
  }

  return Object.freeze(instance);
}
