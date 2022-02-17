/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { isObject, isUint32, TypedArray } from "../utils.js";
import { Component } from "./component.js";
import { SchemaStorage } from "./schema.js";

export interface ComponentInstanceSpec<T> {
  /** The component to instantiate */
  component: Component<T>;
  /** The component instance's identifier */
  id: number;
  /** The component's TypedArray storage object */
  storage?: SchemaStorage<T> | undefined;
}

export interface ComponentInstance<T> extends Component<T> {
  /** The instance's parent component */
  component: Component<T>;
  /** The instance's identifier */
  id: number;
}

/**
 * Create a new ComponentInstance.
 * A ComponentInstance is a Component tied to a World with storage
 * @param spec The ComponentInstance's specification object
 * @param spec.component The component to instantiate
 * @param spec.id The component instance's identifier
 * @param spec.storage The component's TypedArray storage object
 */
export function createComponentInstance<T>(
  spec: ComponentInstanceSpec<T>,
): Readonly<ComponentInstance<T> & Record<keyof T, TypedArray>> {
  const { component, id, storage } = spec;
  if (!component) throw new Error("Component instantiation requires as component!");
  if (!isUint32(id)) throw new SyntaxError("Component ID is invalid.");
  if (storage && !isObject(storage)) throw new TypeError("Component storage is malformed.");
  const instance = Object.create(component, {
    component: {
      value: component,
      configurable: false,
      enumerable: true,
      writable: false,
    },
    id: {
      value: id,
      configurable: false,
      enumerable: true,
      writable: false,
    },
  }) as ComponentInstance<T>;
  return Object.freeze(Object.assign(instance, storage));
}