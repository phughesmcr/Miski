// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, ComponentSpec, createComponent } from './component';

export interface ComponentManagerSpec {
  maxComponents: number,
}

export interface ComponentManger {
  getComponentById: (id: number) => Component<unknown> | undefined;
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getComponents: () => Component<unknown>[];
  isComponentRegistered: <T>(component: Component<T>) => boolean,
  registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
  unregisterComponent: <T>(component: Component<T>) => ComponentSpec<T>;
}

/**
 * Creates a new component manager
 * @param spec the component manager specification object
 */
export function createComponentManager(spec: ComponentManagerSpec): ComponentManger {
  const { maxComponents } = { ...spec };

  /** Component registry by name */
  const _registry: Record<string, Component<unknown>> = {};

  /** Array of unused component ids */
  const _freeIds: number[] = [];

  /** Count of registered components */
  let _count = 0;

  // initialize _freeIds array
  let _n = 0;
  for (let i = maxComponents; i >= 0; i--) {
    _freeIds[i] = _n++;
  }

  /**
   * Create and register a component
   * @param spec the component specification object
   */
  const registerComponent = <T>(spec: ComponentSpec<T>): Component<T> => {
    if (_count >= maxComponents) throw new Error('maximum components reached!');
    if (spec.name in _registry) throw new Error(`component with name "${spec.name}" already registered!`);
    const id = _freeIds.pop();
    if (id === undefined) throw new Error('no available ids!');
    const component = createComponent({...spec, id});
    _registry[component.name] = component;
    _count++;
    return component;
  };

  /**
   * Unregister a component
   * @param component the component to unregister
   */
  const unregisterComponent = <T>(component: Component<T>): ComponentSpec<T> => {
    if (!(component.name in _registry)) throw new Error(`component "${component.name}" is not registered.`);
    delete _registry[component.name];
    _freeIds.unshift(component.id);
    const spec = Object.create(component) as Partial<{ -readonly [P in keyof Component<T>]: Component<T>[P] }>;
    delete spec.id;
    _count--;
    return spec as ComponentSpec<T>;
  };

  /**
   * Find a component by its name
   * @param name the component name to search for
   */
  const getComponentByName = (name: string): Component<unknown> | undefined => _registry[name];

  /**
   * Find a component by its id number
   * @param id the component id to search for
   */
  const getComponentById = (id: number | bigint): Component<unknown> | undefined => {
    if (typeof id === 'number') id = BigInt(id);
    return Object.values(_registry).find((component) => component.id === id);
  };

  /** Returns an array of all registered components  */
  const getComponents = (): Component<unknown>[] => Object.values(_registry);

  /**
   * Check if a component is registered
   * @param component the component to check
   */
  const isComponentRegistered = <T>(component: Component<T>): boolean => (component.name in _registry);

  return Object.freeze({
    getComponentById,
    getComponentByName,
    getComponents,
    isComponentRegistered,
    registerComponent,
    unregisterComponent,
  });
}
