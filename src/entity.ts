// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from './component';
import { createMask } from './mask';

export type Entity = Readonly<{
  /** The entity's archetype */
  archetype: bigint,
  /** The entity's id */
  id: bigint,
  /** Check if a component is present in an entity */
  hasComponent(component: Component<unknown>): boolean,
  /** @hidden */
  _destroy(): Entity,
  /** @hidden */
  _setId(id: bigint): Entity,
  /** @hidden */
  _addComponent(component: Component<unknown>): Entity,
  /** @hidden */
  _removeComponent(component: Component<unknown>): Entity,
}>

/** Reset an entity to a blank state */
export function _destroyEntity(entity: Entity): Entity {
  entity._destroy();
  return entity;
}

/** Create an new entity */
export function _createEntity(): Entity {
  const {
    archetype,
    components,
    componentObjects,
  } = {
    archetype: createMask(0n),
    components: {} as Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    componentObjects: new Set() as Set<Component<unknown>>,
  };

  let { _id } = { _id: 0n };

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

      /** @returns the entity's id */
      id: {
        get: function(): bigint {
          return _id;
        }
      }
    }
  );

  /** @hidden */
  const _destroy = function(): void {
    _id = 0n;
    componentObjects.forEach((component) => _removeComponent(component));
  };

  /** @hidden */
  const _setId = function(id: bigint): void {
    _id = id;
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
        _destroy,
        _setId,
        _addComponent,
        _removeComponent,
        hasComponent,
      }
    )
  ) as Entity;
}