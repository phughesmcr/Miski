// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';
import { validName } from '../utils';
import { World } from '../world';
import { Component, isComponent } from './component';

export type ComponentRegistry = Map<bigint, Component<unknown>>;

export interface ComponentManagerSpec {
  /** The maximum number of components to allow */
  maxComponents: number,
}

export interface ComponentManager {
  getComponentEntities: <T>(component: Component<T>) => Entity[];
  getComponentId: <T>(component: Component<T>) => bigint | undefined;
  getComponentById: (id: bigint) => Component<unknown> | undefined;
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getComponents: () => Component<unknown>[];
  isComponentRegistered: <T>(component: Component<T>) => boolean;
  registerComponent: <T>(component: Component<T>) => World;
  unregisterComponent: <T>(component: Component<T>) => World;
}

function createGetComponentId(registry: ComponentRegistry) {
  function getComponentId<T>(component: Component<T>): bigint | undefined {
    const entry = [...registry.entries()].find(([_, _c]) => component === _c);
    return (entry === undefined) ? undefined : entry[0];
  }
  return getComponentId;
}

function createGetComponents(registry: ComponentRegistry) {
  return function getComponents(): Component<unknown>[] {
    return [...registry.values()];
  };
}

function createGetComponentById(registry: ComponentRegistry) {
  return function getComponentById(id: bigint): Component<unknown> | undefined {
    if (typeof id !== "bigint") {
      throw new SyntaxError(`Expected component id to be of type "bigint", found ${typeof id}.`);
    }
    return registry.get(id);
  };
}

function createGetComponentByName(registry: ComponentRegistry) {
  return function getComponentByName(name: string): Component<unknown> | undefined {
    if (typeof name !== "string") {
      throw new SyntaxError(`Expected component name to be of type "string", found ${typeof name}.`);
    }
    if (!(validName(name))) {
      throw new SyntaxError(`"${name}" is not a valid component name.`);
    }
    return [...registry.values()].find((component) => component.name === name);
  };
}

function createIsComponentRegistered(registry: ComponentRegistry) {
  return function isComponentRegistered<T>(component: Component<T>): boolean {
    if (isComponent(component) === false) {
      throw new TypeError('Provided object is not a Component instance.');
    }
    return [...registry.values()].includes(component);
  };
}

function createRegisterComponent(
    registry: ComponentRegistry,
    count: {value: number},
    maxComponents: number,
    world: World,
  ) {
  return function registerComponent<T>(component: Component<T>): World {
    // check we haven't reached maximum capacity
    if (registry.size >= maxComponents) {
      throw new Error('The maximum number of components has been reached.');
    }
    // check we're dealing with a component
    if (isComponent(component) === false) {
      throw new TypeError('Provided object is not a Component instance.');
    }
    const components = [...registry.values()];
    // check component isn't already registered
    if (components.includes(component)) {
      throw new Error(`Component "${component.name}" is already registered.`);
    }
    // check for duplicate names
    if (components.find((_c) => component.name === _c.name)) {
      throw new Error(`A component with name "${component.name}" is already registered.`);
    }
    // increment total count
    count.value += 1;
    // create and register component
    registry.set(BigInt(count.value), component);
    return world;
  };
}

function createUnregisterComponent(registry: ComponentRegistry, world: World) {
  return function unregisterComponent<T>(component: Component<T>): World {
    // check we're dealing with a component
    if (isComponent(component) === false) {
      throw new TypeError('Provided object is not a Component instance.');
    }
    const entry = [...registry.entries()].find(([_, _c]) => _c === component);
    // check component is registered
    if (!entry) {
      throw new Error(`Component "${component.name}" is not registered.`);
    }
    // remove component from registry
    registry.delete(entry[0]);
    // remove component from entities
    world.getComponentEntities(component).forEach((entity) => entity.removeComponent(component));
    return world;
  };
}

function createGetComponentEntities(world: World) {
  return function getComponentEntities<T>(component: Component<T>): Entity[] {
    const entities: Set<Entity> = new Set();
    const id = world.getComponentId(component);
    if (id !== undefined) {
      world.getArchetypes().forEach(([archetype, set]) => {
        if ((archetype & id) > 0) {
          set.forEach((entity) => entities.add(entity));
        }
      });
    }
    return [...entities];
  };
}

export function createComponentManager(world: World, spec: ComponentManagerSpec): ComponentManager {
  const { maxComponents } = spec;

  const count = { value: 0 };
  const registry: ComponentRegistry = new Map();

  return {
    getComponentEntities: createGetComponentEntities(world),
    getComponentId: createGetComponentId(registry),
    getComponentById: createGetComponentById(registry),
    getComponentByName: createGetComponentByName(registry),
    getComponents: createGetComponents(registry),
    isComponentRegistered: createIsComponentRegistered(registry),
    registerComponent: createRegisterComponent(registry, count, maxComponents, world),
    unregisterComponent: createUnregisterComponent(registry, world),
  };
}
