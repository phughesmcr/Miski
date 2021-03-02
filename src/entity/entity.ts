"use strict";

import { Component } from '../component/component';
import { createMask } from '../utils/mask';
import { clearObject, deepAssign } from '../utils/utils';

export type Entity = Readonly<{
  _: Record<string, unknown>;
  addComponent: <T>(component: Component<T>) => boolean;
  getArchetype: () => bigint;
  hasComponent: <T>(component: Component<T>) => boolean;
  id: string;
  isAwake: () => boolean;
  next: (next?: Entity | null) => Entity | null;
  purge: () => void;
  removeComponent: <T>(component: Component<T>) => boolean;
  sleep: () => boolean;
  wake: () => boolean;
}>

/** Creates an entity */
export function createEntity(): Entity {
  /** The entity's archetype mask */
  const _archetype = createMask();

  /** A unique id for the entity */
  const _id = `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;

  /** Container for the entity's component properties */
  const _properties = {} as Record<string, unknown>;

  /** The entity's status */
  let _awake = true;

  /** The next entity in the entity pool */
  let _next: Entity | null = null;

  /** The entity object */
  const entity = Object.create({}, {
    // shorthand accessor for the entity's component properties
    _: {
      value: _properties,
      enumerable: true,
    },
    addComponent: {
      value: <T>(component: Component<T>): boolean => {
        /** @todo validation */
        if (component.name in _properties) {
          console.warn(`Entity "${_id}" already has component "${component.name}".`);
          return false;
        }
        try {
          _properties[component.name] = deepAssign({}, component.properties);
          _archetype.on(component.id);
        } catch (err) {
          console.warn(`Error adding component "${component.name}" to entity "${_id}".`, err);
          return false;
        }
        return true;
      },
    },
    getArchetype: {
      value: (): bigint => _archetype.value(),
    },
    hasComponent: {
      value: <T>(component: Component<T> | string): boolean => {
        return ((typeof component === "string") ? component in _properties : component.name in _properties) ?? false;
      },
    },
    isAwake: {
      value: (): boolean => _awake,
    },
    id: {
      value: _id,
      enumerable: true,
    },
    next: {
      value: (next?: Entity | null): Entity | null => {
        if (next !== undefined) {
          _next = next;
        }
        return _next;
      }
    },
    purge: {
      value: (): void => {
        clearObject(_properties);
        _archetype.clear();
      },
    },
    removeComponent: {
      value: <T>(component: Component<T>): boolean => {
        /** @todo validation */
        if (!(component.name in _properties)) return false;
        delete _properties[component.name];
        _archetype.off(component.id);
        return true;
      },
    },
    sleep: {
      value: (): boolean => _awake = false,
    },
    wake: {
      value: (): boolean => _awake = true,
    },
  }) as Entity;

  return Object.freeze(entity);
}
