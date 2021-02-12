// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, ComponentSpec, createComponent as _createComponent } from './component';

export interface ComponentManagerSpec {
  maxComponents: number,
}

export interface ComponentManger {
  registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
  unregisterComponent: <T>(component: Component<T>) => ComponentSpec<T>;
  isComponentRegistered: <T>(component: Component<T>) => boolean,
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getComponentById: (id: number) => Component<unknown> | undefined;
  getComponents: () => Component<unknown>[];
}

export function createComponentManager(spec: ComponentManagerSpec): ComponentManger {
  const { maxComponents } = { ...spec };

  const _registry: Record<string, Component<unknown>> = {};
  const _freeIds: number[] = [];
  let _n = 0;

  // initialize _freeIds array
  let _count = 0;
  for (let i = maxComponents; i >= 0; i--) {
    _freeIds[i] = _count++;
  }

  const registerComponent = <T>(spec: ComponentSpec<T>): Component<T> => {
    if (_n >= maxComponents) {
      throw new Error('maximum components reached!');
    }
    if (spec.name in _registry) {
      throw new Error(`component with name "${spec.name}" already registered!`);
    }
    const id = _freeIds.pop();
    if (id === undefined) {
      throw new Error('no available ids!');
    }
    const component = _createComponent({...spec, id});
    _registry[component.name] = component;
    _n++;
    return component;
  };

  const unregisterComponent = <T>(component: Component<T>): ComponentSpec<T> => {
    if (!(component.name in _registry)) {
      throw new Error(`component "${component.name}" is not registered.`);
    }
    delete _registry[component.name];
    _freeIds.unshift(component.id);
    const spec = Object.create(component) as Partial<{ -readonly [P in keyof Component<T>]: Component<T>[P] }>;
    delete spec.id;
    _n--;
    return spec as ComponentSpec<T>;
  };

  const getComponentByName = (name: string): Component<unknown> | undefined => {
    return _registry[name];
  };

  const getComponentById = (id: number | bigint): Component<unknown> | undefined => {
    if (typeof id === 'number') id = BigInt(id);
    return Object.values(_registry).find((component) => component.id === id);
  };

  const getComponents = (): Component<unknown>[] => Object.values(_registry);

  const isComponentRegistered = <T>(component: Component<T>): boolean => (component.name in _registry);

  return Object.freeze({
    registerComponent,
    unregisterComponent,
    isComponentRegistered,
    getComponentByName,
    getComponentById,
    getComponents,
  });
}
