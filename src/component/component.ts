// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { deepAssignObjects, isObject, validName } from '../utils';

export interface ComponentSpec<T extends Record<keyof T, T>> {
  name: string;
  defaults: T;
}

export interface Component<T> extends IComponent {
  name: string;
  defaults: T;
}

interface IComponent {
  isComponent: true;
}

/**
 * Component properties must be non-empty objects
 * @param defaults the default properties object to validate
 * @returns true if object is valid
 */
function isValidDefaults<T>(defaults: T): defaults is T {
  return isObject(defaults) && Object.keys(defaults).length > 0;
}

function Component(this: IComponent) {
  this.isComponent = true;
}

/**
 * Test if an object is a valid component
 * @param component the object to test
 * @returns true if the
 */
export function isComponent(object: unknown): object is Component<unknown> {
  return object instanceof Component;
}

export function createComponent<T extends Record<keyof T, T>>(spec: ComponentSpec<T>): Component<T> {
  const { name, defaults } = spec;

  // check validity of name
  if (!validName(name)) {
    throw new SyntaxError(`"${name}" is not a valid component name.`);
  }

  // check validity of properties
  if(!isValidDefaults(defaults)) {
    throw new TypeError(`Component "${name}"'s default properties are invalid.`);
  }

  // deep clone default properties
  const _defaults = Object.freeze(deepAssignObjects({}, defaults as unknown as Record<string, unknown>));

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
