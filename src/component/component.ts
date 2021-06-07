// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { deepAssignObjects, isObject, isValidName } from '../utils';

export interface ComponentSpec<T extends Record<keyof T, T>> {
  name: string;
  defaults: T;
}

export interface Component<T> extends ComponentPrototype {
  name: string;
  defaults: T;
}

interface ComponentPrototype {
  isComponent: true;
}

/** Component prototype */
const Component = Object.create(null, {
  isComponent: {
    value: true,
    enumerable: true,
    configurable: false,
  }
}) as ComponentPrototype;

/**
 * Component properties must be non-empty objects
 * @param defaults the default properties object to validate
 * @returns true if object is valid
 */
function isValidDefaults<T>(defaults: T): defaults is T {
  return isObject(defaults) && Object.keys(defaults).length > 0;
}

/**
 * Test if an object is a valid component
 * @param component the object to test
 * @returns true if the
 */
export function isComponent(object: unknown): object is Component<unknown> {
  return Boolean(
    isObject(object) &&
    Object.is(Component, Object.getPrototypeOf(object)) &&
    object['name'] !== undefined &&
    object['defaults'] !== undefined
  );
}

/**
 * Creates and returns a new component object
 * @param spec the component's specification
 * @param spec.name the component's name
 * @param spec.defaults the component's default properties
 * @returns the created component
 */
export function createComponent<T extends Record<keyof T, T>>(spec: ComponentSpec<T>): Component<T> {
  const { name, defaults } = spec;

  // check validity of name
  if (!isValidName(name)) {
    throw new SyntaxError('Component name is invalid.');
  }

  // check validity of properties
  if(!isValidDefaults(defaults)) {
    throw new TypeError(`Component "${name}"'s default properties are invalid.`);
  }

  // deep clone default properties
  const _defaults = deepAssignObjects({}, defaults as unknown as Record<string, unknown>);

  return Object.create(Component, {
    defaults: {
      value: _defaults,
      enumerable: true,
    },
    name: {
      value: name,
      enumerable: true,
    },
  }) as Component<T>;
}
