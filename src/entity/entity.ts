// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from '../component/component';
import { Mask } from '../mask/mask';
import { Poolable } from '../pool/pool';
import { deepAssignObjects, Toggleable } from '../utils';
import { World } from '../world';

export interface Entity {
  [property: string]: unknown;
}

export class Entity implements Toggleable, Poolable<Entity> {
  private _archetype: Mask;
  private _enabled: boolean;
  private _next: Entity | null;
  private _properties: Map<Component<unknown>, Record<string, unknown>>;
  private _world: World;
  readonly id: string;

  constructor(world: World) {
    this.id = `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
    this._archetype = new Mask();
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

    if (component instanceof Component) {
      if (this._properties.has(component)) {
        throw new Error(`Entity already has component "${component.name}".`);
      }
      // eslint-disable-next-line max-len
      this._properties.set(component, deepAssignObjects({}, component.defaults as Record<string, unknown>, properties??{}));
      Object.defineProperty(this, component.name, {
        get: () => {
          return this._properties.get(component);
        },
        set: (val: T) => {
          const _c = this._properties.get(component);
          if (Object.isFrozen(_c)) {
            throw new Error(`Properties in component "${component.name}" cannot be modified.`);
          } else if (_c) {
            // Prevent accidental adding of new keys
            Object.entries(val).forEach(([key, prop]) => {
              if (key in _c) {
                _c[key] = prop;
              } else {
                throw new Error(`Property "${key}" does not exist in component "${component.name}".`);
              }
            });
          } else {
            throw new Error(`Component "${component.name}" does not exist in entity.`);
          }
        },
        enumerable: true,
        configurable: true,
      });
      const prev = this._archetype.value;
      this._archetype.on(component.id);
      this._world.updateArchetype(this, prev);
      return this;
    } else {
      throw new SyntaxError('Invalid or unregistered component.');
    }
  }

  clear(): this {
    Object.keys(this._properties).forEach((key) => delete this[key]);
    this._properties.clear();
    const prev = this._archetype.value;
    this._archetype.clear();
    this._world.updateArchetype(this, prev);
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
    return this._archetype.value;
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
    this._properties.delete(component);
    try {
      delete this[component.name];
    } catch (err) {
      console.warn(`Could not remove property ${component.name} from entity.`);
    }
    const prev = this._archetype.value;
    this._archetype.off(component.id);
    this._world.updateArchetype(this, prev);
    return this;
  }
}
