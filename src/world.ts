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
  addComponentsToEntity: (entity: Entity, ...components: Component<unknown>[]) => Entity;
  createEntity: () => Entity;
  destroyEntity: (entity: Entity) => boolean;
  entity: Entity;
  getComponentById: (id: number) => Component<unknown> | undefined;
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getComponents: () => Component<unknown>[];
  getEntities: () => Entity[];
  getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
  getEntityById: (id: string) => Entity | undefined;
  getSystemByIndex: (index: number) => System | undefined;
  getSystemByName: (name: string) => System | undefined;
  getSystems: () => System[];
  isComponentRegistered: <T>(component: Component<T>) => boolean;
  isSystemRegistered: (system: System) => boolean;
  moveSystem: (system: System, idx: number) => boolean;
  postUpdate: (int: number) => void;
  preUpdate: () => void;
  registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
  registerSystem: (spec: SystemSpec) => System;
  removeComponentsFromEntity: (entity: Entity, ...components: Component<unknown>[]) => Entity;
  unregisterComponent: <T>(component: Component<T>) => ComponentSpec<T>;
  unregisterSystem: (system: System) => void;
  update: (dt: number) => void;
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
    areArchetypesDirty,
    cleanedArchetypes,
    createEntity,
    destroyEntity,
    getEntities,
    getEntitiesByComponents,
    getEntitiesByMask,
    getEntitiesFromMasks,
    getEntityById,
    rebuildArchetypes,
    updateArchetype,
  } = createEntityManager({
    initialPoolSize,
    maxEntities,
  });

  // Component
  const {
    getComponentById,
    getComponentByName,
    getComponents,
    isComponentRegistered,
    registerComponent,
    unregisterComponent,
  } = createComponentManager({
    maxComponents,
  });

  // System
  const {
    getSystemByIndex,
    getSystemByName,
    getSystems,
    isSystemRegistered,
    moveSystem,
    registerSystem,
    unregisterSystem,
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

  const _systemMasks: Record<string, bigint[]> = {};

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
    if (_isFirstRun === true) {
      rebuildArchetypes();
      _isFirstRun = false;
    }
    const systems = getSystems();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      if (system.enabled === false) continue;
      if (areArchetypesDirty() === true || !(system.name in _systemMasks)) {
        const [masks, entities] = getEntitiesByMask(system.archetype, system.exclusive);
        _systemMasks[system.name] = masks;
        system.preUpdate(entities, system);
        cleanedArchetypes();
      } else {
        const masks = _systemMasks[system.name];
        const entities = getEntitiesFromMasks(masks);
        system.preUpdate(entities, system);
      }
     }
  };

  const update = (dt: number): void => {
    if (_isFirstRun === true) {
      rebuildArchetypes();
      _isFirstRun = false;
    }
    const systems = getSystems();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      if (system.enabled === false) continue;
      if (areArchetypesDirty() === true || !(system.name in _systemMasks)) {
        const [masks, entities] = getEntitiesByMask(system.archetype, system.exclusive);
        _systemMasks[system.name] = masks;
        system.update(dt, entities, system);
        cleanedArchetypes();
      } else {
        const masks = _systemMasks[system.name];
        const entities = getEntitiesFromMasks(masks);
        system.update(dt, entities, system);
      }
    }
  };

  const postUpdate = (int: number): void => {
    if (_isFirstRun === true) {
      rebuildArchetypes();
      _isFirstRun = false;
    }
    const systems = getSystems();
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      if (system.enabled === false) continue;
      if (areArchetypesDirty() === true || !(system.name in _systemMasks)) {
        const [masks, entities] = getEntitiesByMask(system.archetype, system.exclusive);
        _systemMasks[system.name] = masks;
        system.postUpdate(int, entities, system);
        cleanedArchetypes();
      } else {
        const masks = _systemMasks[system.name];
        const entities = getEntitiesFromMasks(masks);
        system.postUpdate(int, entities, system);
      }
    }
  };

  // finalizations
  addComponentsToEntity(worldEntity, worldComponent);

  return Object.freeze({
    addComponentsToEntity,
    createEntity,
    destroyEntity,
    entity: worldEntity,
    getComponentById,
    getComponentByName,
    getComponents,
    getEntities,
    getEntitiesByComponents,
    getEntitiesByMask,
    getEntityById,
    getSystemByIndex,
    getSystemByName,
    getSystems,
    isComponentRegistered,
    isSystemRegistered,
    moveSystem,
    postUpdate,
    preUpdate,
    registerComponent,
    registerSystem,
    removeComponentsFromEntity,
    unregisterComponent,
    unregisterSystem,
    update,
  });
}