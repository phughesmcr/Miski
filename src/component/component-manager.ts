// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { validName } from '../utils';
import { World } from '../world';
import { Component, ComponentSpec } from './component';

export interface ComponentManagerSpec {
  /** The maximum number of components to allow */
  maxComponents: number,
}

export interface ComponentManager {
  /**
   * Find a component by its id
   * @param id the components bigint id
   */
  getComponentById: (id: bigint) => Component<unknown> | undefined;
  /**
   * Find a component by its name
   * @param name the component's name string
   */
  getComponentByName: (name: string) => Component<unknown> | undefined;
  /** @returns an array of all components in the world */
  getComponents: () => Component<unknown>[];
  /** @returns true if the component is registered in this world */
  isComponentRegistered: <T>(component: Component<T>) => boolean;
  /**
   * Creates and registers a new component
   * @param spec the component specification
   * @returns the new component
   */
  registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
  /**
   * Unregisters a given component
   * @returns the world
   */
  unregisterComponent: <T>(component: Component<T>) => World;
}

function createGetComponents(registry: Map<string, Component<unknown>>) {
  return function getComponents(): Component<unknown>[] {
    return [...registry.values()];
  };
}

function createGetComponentById(registry: Map<string, Component<unknown>>) {
  return function getComponentById(id: bigint): Component<unknown> | undefined {
    return [...registry.values()].find((component) => component.id === id);
  };
}

function createGetComponentByName(registry: Map<string, Component<unknown>>) {
  return function getComponentByName(name: string): Component<unknown> | undefined {
    return registry.get(name);
  };
}

function createIsComponentRegistered(registry: Map<string, Component<unknown>>) {
  return function isComponentRegistered<T>(component: Component<T>): boolean {
    return registry.has(component.name) || [...registry.values()].includes(component);
  };
}

// eslint-disable-next-line max-len
function createRegisterComponent(registry: Map<string, Component<unknown>>, count: {value: bigint}, maxComponents: number, world: World) {
  return function registerComponent<T>(spec: ComponentSpec<T>): Component<T> {
    // check we haven't reached maximum capacity
    if (registry.size >= maxComponents) {
      throw new Error('Maximum number of components reached.');
    }
    // check validity of name
    if (!validName(spec.name)) {
      throw new SyntaxError(`"${spec.name}" is not a valid component name.`);
    }
    // check for duplicate names
    if (registry.has(spec.name)) {
      throw new Error(`Component with name "${spec.name}" already registered.`);
    }
    // increment total count
    count.value += 1n;
    // create and register component
    const component = new Component(world, count.value, spec);
    registry.set(component.name, component);
    return component;
  };
}

function createUnregisterComponent(registry: Map<string, Component<unknown>>, world: World) {
  return function unregisterComponent<T>(component: Component<T>): World {
    // check component is registered
    if (!(registry.has(component.name))) {
      throw new Error(`Component "${component.name}" is not registered.`);
    }
    // remove component from entities
    component.getEntities().forEach((entity) => entity.removeComponent(component));
    // remove component from registry
    registry.delete(component.name);
    return world;
  };
}

export function createComponentManager(world: World, spec: ComponentManagerSpec): ComponentManager {
  const { maxComponents } = spec;

  const count = { value: 0n };
  const registry: Map<string, Component<unknown>> = new Map();

  return {
    getComponentById: createGetComponentById(registry),
    getComponentByName: createGetComponentByName(registry),
    getComponents: createGetComponents(registry),
    isComponentRegistered: createIsComponentRegistered(registry),
    registerComponent: createRegisterComponent(registry, count, maxComponents, world),
    unregisterComponent: createUnregisterComponent(registry, world),
  };
}
