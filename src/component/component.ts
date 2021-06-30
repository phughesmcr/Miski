/**
 * @name        Component
 * @description Components house data relating to entities
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { Bitmask, createBitmask } from "../utils/bitmasks";
import { isObject, SOA } from "../utils/objects";
import { isValidName } from "../utils/strings";
import { isTypedArray, TypedArray } from "../utils/types";
import { World } from "../world";
import { isValidSchema, Schema, SchemaProperty } from "./schema";

const $isComponent = Symbol();
const $isComponentInstance = Symbol();

/** Component specification object */
export interface ComponentSpec<T> {
  name: string;
  schema: Schema<T>;
}

/** Component object */
export type Component<T> = ComponentPrototype & {
  name: string;
  schema: Schema<T>;
};

/** Component prototype object */
export interface ComponentPrototype {
  readonly [$isComponent]: true;
}

/** Component prototype object */
const ComponentProto = Object.create(Object.prototype, {
  [$isComponent]: {
    value: true,
    enumerable: true,
    configurable: false,
    writable: false,
  },
}) as ComponentPrototype;

export interface ComponentInstanceSpec {
  id: number;
  world: World;
}

export type ComponentInstance<T> = ComponentInstancePrototype &
  Component<T> &
  SOA<T> & {
    entities: Bitmask;
    id: number;
    world: World;
    getPropertyArrays: () => [string, unknown[] | TypedArray][];
  };

export interface ComponentInstancePrototype {
  [$isComponentInstance]: true;
}

const InstanceProto = {
  [$isComponentInstance]: {
    value: true,
    enumerable: true,
    configurable: false,
    writable: false,
  },
};

export function isComponent(object: unknown): object is Component<unknown> {
  return isObject(object) && Object.is(ComponentProto, Object.getPrototypeOf(object));
}

export function isComponentInstance(object: unknown): object is ComponentInstance<unknown> {
  return isObject(object) && object[$isComponentInstance as never] === true;
}

export function createComponentInstance<T>(component: Component<T>, spec: ComponentInstanceSpec): ComponentInstance<T> {
  // are we dealing with a valid component?
  if (isComponent(component) === false) {
    throw new TypeError("createComponentInstance: Invalid component provided.");
  }

  const { schema } = component;
  const { id, world } = spec;

  // create prototype
  const proto = Object.create(component, InstanceProto) as ComponentInstancePrototype;

  const instance = Object.create(proto, {
    entities: {
      value: createBitmask(world.config.maxEntities),
      enumerable: true,
      configurable: false,
      writable: false,
    },
    id: {
      value: id,
      enumerable: true,
      writable: false,
      configurable: false,
    },
    world: {
      value: world,
      enumerable: true,
      writable: false,
      configurable: false,
    },
    getPropertyArrays: {
      value: function (this: ComponentInstance<T>): [string, Array<unknown> | TypedArray][] {
        const schema = Object.keys(this.schema);
        return Object.entries(this).filter(([key, _]) => schema.includes(key)) as [
          string,
          Array<unknown> | TypedArray
        ][];
      },
      enumerable: true,
      writable: false,
      configurable: false,
    },
  }) as ComponentInstance<T>;

  Object.entries(schema).forEach(([key, value]) => {
    const { clone, create, init } = value as SchemaProperty<unknown, unknown>;
    let array;
    if (isTypedArray(init)) {
      const buffer = new ArrayBuffer(init.BYTES_PER_ELEMENT * world.config.maxEntities);
      array = create(buffer);
    } else {
      array = new Array(world.config.maxEntities).fill(clone(init));
    }
    Object.defineProperty(instance, key, {
      value: array,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  });

  return instance;
}

/**
 * Creates and returns a new component object
 * @param spec the component's specification
 * @param spec.name the component's name
 * @param spec.schema the component's schema specification
 * @returns the created component
 */
export function createComponent<T>(spec: ComponentSpec<T>): Component<T> {
  const { name, schema } = spec;

  // check validity of name
  if (!isValidName(name)) {
    throw new SyntaxError("createComponent: supplied name is invalid.");
  }

  // check validity of properties
  if (!isValidSchema(schema)) {
    throw new TypeError(`createComponent: Schema for "${name}" is invalid.`);
  }

  return Object.create(ComponentProto, {
    name: {
      value: name,
      enumerable: true,
      configurable: false,
      writable: false,
    },
    schema: {
      value: { ...schema },
      enumerable: true,
      configurable: false,
      writable: false,
    },
  }) as Component<T>;
}
