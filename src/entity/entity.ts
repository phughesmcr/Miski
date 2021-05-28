// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, isComponent } from '../component/component';
import { Poolable } from '../pool/pool';
import { deepAssignObjects, Toggleable } from '../utils';
import { World } from '../world';

export interface Entity {
  [property: string]: unknown;
}

export class Entity implements Toggleable, Poolable<Entity> {
  static _id = 0;

  private _archetype: bigint;
  private _enabled: boolean;
  private _next: Entity | null;
  private _properties: Map<Component<unknown>, Record<string, unknown>>;
  private _world: World;
  readonly id: number;

  constructor(world: World) {
    this.id = Entity._id++;
    this._archetype = 0n;
    this._enabled = false;
    this._next = null;
    this._properties = new Map();
    this._world = world;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get next(): Entity | null {
    return this._next;
  }

  set next(next: Entity | null) {
    this._next = next;
  }

  addComponent<T>(component: Component<T>, properties?: T): this {
    if (typeof component === 'string') {
      const tmp = this._world.getComponentByName(component);
      if (tmp) {
        component = tmp as Component<T>;
      } else {
        throw new Error(`Component "${component as string}" not found!`);
      }
    }

    if (isComponent(component)) {
      if (this._properties.has(component)) {
        throw new Error(`Entity already has component "${component.name}".`);
      }
      const id = this._world.getComponentId(component);
      if (!id) {
        throw new Error('Component is not registered.');
      }
      this._properties.set(
        component,
        deepAssignObjects(
          {},
          component.defaults as Record<string, unknown>,
          properties ?? {},
        )
      );
      Object.defineProperty(this, component.name, {
        get: () => {
          return this._properties.get(component);
        },
        set: (val: T) => {
          const _c = this._properties.get(component);
          if (_c) {
            // Prevent accidental adding of new keys
            Object.entries(val).forEach(([key, prop]) => {
              if (key in _c) {
                _c[key] = prop;
              }
            });
          }
        },
        enumerable: true,
        configurable: true,
      });
      const prev = this._archetype;
      this._archetype |= (1n << id);
      this._world.updateArchetype(this, prev);
      return this;
    } else {
      throw new SyntaxError('Invalid component.');
    }
  }

  clear(): this {
    const prev = this._archetype;
    this._archetype = 0n;
    this._world.updateArchetype(this, prev);
    Object.keys(this._properties).forEach((key) => delete this[key]);
    this._properties.clear();
    return this;
  }

  disable(): this {
    this._enabled = false;
    return this;
  }

  enable(): this {
    this._enabled = true;
    return this;
  }

  getArchetype(): bigint {
    return this._archetype;
  }

  hasComponent<T>(component: Component<T> | string): boolean {
    const name = (typeof component === "string") ? component : component.name;
    return Boolean(Reflect.has(this._properties, name));
  }

  removeComponent<T>(component: Component<T>): this {
    if (typeof component === 'string') {
      const tmp = this._world.getComponentByName(component);
      if (tmp) {
        component = tmp as Component<T>;
      } else {
        throw new Error(`Component "${component as string}" not found!`);
      }
    }
    if (!(this._properties.has(component))) {
      throw new Error(`Entity ${this.id} has no component "${component.name}".`);
    }
    const id = this._world.getComponentId(component);
    if (!id) {
      throw new Error('Component is not registered.');
    }
    this._properties.delete(component);
    try {
      delete this[component.name];
    } catch (err) {
      console.warn(`Could not remove property ${component.name} from entity.`);
    }
    const prev = this._archetype;
    this._archetype &= ~(1n << id);
    this._world.updateArchetype(this, prev);
    return this;
  }
}
