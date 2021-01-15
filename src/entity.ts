// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from './component';
import { createMask } from './mask';
import { World } from './world';

export type Entity = Readonly<{
  /** The entity's archetype */
  archetype: bigint,
  /** Array of components associated with the entity */
  allComponents: Component<unknown>[],
  /** The entity's id */
  id: bigint,
  /** The entity's world */
  world: World | null,
  /** Check if a component is present in an entity */
  hasComponent(component: Component<unknown>): boolean,
  /** @hidden */
  _setId(id: bigint): Entity,
  /** @hidden */
  _setWorld(world: World | null): void,
  /** @hidden */
  _addComponent(component: Component<unknown>): Entity,
  /** @hidden */
  _removeComponent(component: Component<unknown>): Entity,
}>

/** Create an new entity */
export function _createEntity(): Entity {
  const archetype = createMask(0n);
  const components = {} as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const componentObjects = new Set() as Set<Component<unknown>>;

  let _id = 0n;
  let _world: World | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const data = Object.create(
    { components },
    {
      /** @returns the entity's archetype */
      archetype: {
        get: function(): bigint {
          return archetype.value;
        }
      },

      /** @returns an array of this entity's components */
      allComponents: {
        get: function(): Component<unknown>[] {
          return Array.from(componentObjects);
        }
      },

      /** @returns the entity's id */
      id: {
        get: function(): bigint {
          return _id;
        }
      },

      world: {
        get: function(): World | null | undefined {
          return _world;
        },
      }
    }
  );

  /** @hidden */
  const _setId = function(id: bigint): void {
    _id = id;
  };

  /** @hidden */
  const _setWorld = function(world: World | null) {
    _world = world;
  };

  /** @hidden */
  const _addComponent = function<T>(component: Component<T>): void {
    if (!components[component.name]) {
      components[component.name] = {...component.properties};
      archetype.set(component.id);
      componentObjects.add(component);
    }
  };

  /** @hidden */
  const _removeComponent = function<T>(component: Component<T>): void {
    if (components[component.name]) {
      delete components[component.name];
      archetype.unset(component.id);
      componentObjects.delete(component);
    }
  };

  /**
   * Check if a component is present in the entity
   * @param component the component or component name to test for
   */
  const hasComponent = function<T>(component: Component<T> | string): boolean {
    const name = (typeof component === 'string') ? component : component.name;
    return Boolean(components[name]);
  };

  return Object.freeze(
    Object.assign(
      data,
      {
        _setId,
        _setWorld,
        _addComponent,
        _removeComponent,
        hasComponent,
      }
    )
  ) as Entity;
}