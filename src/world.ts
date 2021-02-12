// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, ComponentSpec } from './component/component';
import { createComponentManager } from './component/component_manager';
import { Entity } from './entity/entity';
import { createEntityManager } from './entity/entity_manager';
import { System, SystemSpec } from './system/system';
import { createSystemManager } from './system/system_manager';

export interface WorldSpec {
  initialPoolSize?: number;
  maxComponents?: number;
  maxEntities?: number;
}

export type World = Readonly<{
  entity: Entity;
  createEntity: () => Entity;
  destroyEntity: (entity: Entity) => boolean;
  addComponentsToEntity: (entity: Entity, ...components: Component<unknown>[]) => Entity;
  removeComponentsFromEntity: (entity: Entity, ...components: Component<unknown>[]) => Entity;
  getEntities: () => Entity[];
  getComponents: () => Component<unknown>[];
  getSystems: () => System[];
  getComponentById: (id: number) => Component<unknown> | undefined;
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
  getEntityById: (id: string) => Entity | undefined;
  getSystemByIndex: (index: number) => System | undefined;
  getSystemByName: (name: string) => System | undefined;
  isComponentRegistered: <T>(component: Component<T>) => boolean;
  isSystemRegistered: (system: System) => boolean;
  moveSystem: (system: System, idx: number) => boolean;
  registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
  registerSystem: (spec: SystemSpec) => System;
  unregisterComponent: <T>(component: Component<T>) => ComponentSpec<T>;
  unregisterSystem: (system: System) => void;
  preUpdate: () => void;
  update: (dt: number) => void;
  postUpdate: (int: number) => void;
}>

export function createWorld(spec: WorldSpec): World {
  // Spec
  const {
    initialPoolSize = 64,
    maxComponents = 1024,
    maxEntities = 100000,
  } = { ...spec };

  let _isFirstRun = false;

  // Entity
  const {
    createEntity,
    destroyEntity,
    getEntityById,
    getEntities,
    getEntitiesByMask,
    getEntitiesByComponents,
    rebuildArchetypes,
    updateArchetype,
    areArchetypesDirty,
    cleanedArchetypes,
  } = createEntityManager({
    initialPoolSize,
    maxEntities,
  });

  // Component
  const {
    registerComponent,
    unregisterComponent,
    isComponentRegistered,
    getComponentByName,
    getComponentById,
    getComponents,
  } = createComponentManager({
    maxComponents,
  });

  // System
  const {
    registerSystem,
    unregisterSystem,
    getSystemByName,
    getSystemByIndex,
    getSystems,
    moveSystem,
    isSystemRegistered,
  } = createSystemManager();

  // world.entity Initialization
  const worldEntity = createEntity();
  const worldComponent = registerComponent<{ isWorld: boolean }>({
    name: "world",
    properties: {
      isWorld: true,
    },
    entityLimit: 1,
    removable: false,
  });

  const _systemEntities: Record<string, Entity[]> = {};

  // Public methods
  const addComponentsToEntity = (entity: Entity, ...components: (Component<unknown> | string)[]): Entity => {
    if (!entity) {
      throw new Error('no entity provided.');
    }
    if (!components?.length) {
      throw new Error('no components provided.');
    }
    const len = components.length;
    let i: number;
    for (i = 0; i < len; i++) {
      let component: Component<unknown> | undefined;
      if (typeof components[i] === 'string') {
        component = getComponentByName(components[i] as string);
      } else {
        component = components[i] as Component<unknown>;
      }
      if (!component) {
        throw new Error(`component ${components[i] as string} is not registered!.`);
      }
      if (!entity.hasComponent(component)) {
        const previousArchetype = entity.getArchetype();
        entity.addComponent(component);
        updateArchetype(entity, previousArchetype);
      }
    }
    return entity;
  };

  const removeComponentsFromEntity = (entity: Entity, ...components: (Component<unknown> | string)[]): Entity => {
    if (!entity) {
      throw new Error('no entity provided.');
    }
    if (!components?.length) {
      throw new Error('no components provided.');
    }
    const len = components.length;
    let i: number;
    for (i = 0; i < len; i++) {
      let component: Component<unknown> | undefined;
      if (typeof components[i] === 'string') {
        component = getComponentByName(components[i] as string);
      } else {
        component = components[i] as Component<unknown>;
      }
      if (!component) {
        throw new Error(`component ${components[i] as string}  is not registered.`);
      }
      if (entity.hasComponent(component)) {
        const previousArchetype = entity.getArchetype();
        entity.removeComponent(component);
        updateArchetype(entity, previousArchetype);
      }
    }
    return entity;
  };

  const preUpdate = (): void => {
    if (_isFirstRun) {
      rebuildArchetypes();
      _isFirstRun = false;
    }
    const systems = getSystems();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      if (system.enabled === false) continue;
      if (areArchetypesDirty() === true) {
        const entities = getEntitiesByMask(system.archetype, system.exclusive);
        _systemEntities[system.name] = entities;
        system.preUpdate(entities, system);
      } else {
        system.preUpdate(_systemEntities[system.name], system);
      }
     }
     cleanedArchetypes();
  };

  const update = (dt: number): void => {
    if (_isFirstRun) {
      rebuildArchetypes();
      _isFirstRun = false;
    }
    const systems = getSystems();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      if (system.enabled === false) continue;
      if (areArchetypesDirty() === true) {
        const entities = getEntitiesByMask(system.archetype, system.exclusive);
        _systemEntities[system.name] = entities;
        system.update(dt, entities, system);
      } else {
        system.update(dt, _systemEntities[system.name], system);
      }
    }
    cleanedArchetypes();
  };

  const postUpdate = (int: number): void => {
    if (_isFirstRun) {
      rebuildArchetypes();
      _isFirstRun = false;
    }
    const systems = getSystems();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      if (system.enabled === false) continue;
      if (areArchetypesDirty() === true) {
        const entities = getEntitiesByMask(system.archetype, system.exclusive);
        _systemEntities[system.name] = entities;
        system.postUpdate(int, entities, system);
      } else {
        system.postUpdate(int, _systemEntities[system.name], system);
      }
    }
    cleanedArchetypes();
  };

  // finalizations
  addComponentsToEntity(worldEntity, worldComponent);
  rebuildArchetypes();

  return Object.freeze({
    entity: worldEntity,
    getComponents,
    getEntities,
    getSystems,
    createEntity,
    destroyEntity,
    addComponentsToEntity,
    removeComponentsFromEntity,
    getComponentById,
    getComponentByName,
    getEntitiesByComponents,
    getEntityById,
    getEntitiesByMask,
    getSystemByIndex,
    getSystemByName,
    isComponentRegistered,
    isSystemRegistered,
    moveSystem,
    registerComponent,
    registerSystem,
    unregisterComponent,
    unregisterSystem,
    preUpdate,
    update,
    postUpdate,
  });
}