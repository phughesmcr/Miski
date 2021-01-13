// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, ComponentSpec, WorldComponent, _createComponent } from './component';
import { Entity, _createEntity } from './entity';
import { _createPool } from './pool';
import { System, SystemSpec, _createSystem } from './system';

interface WorldSpec {
  initialPoolSize?: number | bigint;
  maxComponents?: number | bigint;
}

export interface World {
  archetypes: [bigint, Set<Entity>][],
  components: Component<unknown>[],
  component: Component<WorldComponent>,
  entities: Entity[],
  entity: Entity,
  systems: System[],
  createEntity(): Entity,
  removeEntity(entity: Entity): boolean,
  createComponent<T>(spec: ComponentSpec<T>): Component<T>,
  removeComponent<T>(component: Component<T>): boolean,
  addComponentsToEntity(entity: Entity, ...components: Component<unknown>[]): Entity,
  removeComponentsFromEntity(entity: Entity, ...components: Component<unknown>[]): Entity,
  createSystem(spec: SystemSpec, idx?: number): System,
  removeSystem(system: System): boolean,
  update(dt: number): void,
  render(int: number): void,
}

export function createWorld(spec: WorldSpec): World {
  // world config
  const {
    initialPoolSize = 10,
    maxComponents = 1024n,
  } = { ...spec };

  // constants
  const {
    archetypes,
    components,
    entities,
    systems,
    entityPool,
  } = {
    archetypes: new Map() as Map<bigint, Set<Entity>>,
    components: new Map() as Map<string, Component<unknown>>,
    entities: new Map() as Map<bigint, Entity>,
    systems: [] as System[],
    entityPool: _createPool({create: _createEntity, destroy: _destroyEntity, initialSize: initialPoolSize}),
  };

  // variables
  let {
    componentCount,
    entityCount,
    systemCount,
    worldComponent,
    worldEntity,
  } = {
    componentCount: 0n,
    entityCount: 0n,
    systemCount: 0n,
    worldComponent: {} as Component<WorldComponent>,
    worldEntity: {} as Entity,
  };

  /** @private **/
  const addEntityToArchetypeArray = (entity: Entity) => {
    if (archetypes.get(entity.archetype) === undefined) {
      archetypes.set(entity.archetype, new Set());
    }
    archetypes.get(entity.archetype)?.add(entity);
  };

  /** @private */
  const removeEntityFromArchetypeArray = (entity: Entity) => {
    archetypes.get(entity.archetype)?.delete(entity);
  };

  /** @private */
  function _destroyEntity(entity: Entity): Entity {
    entity._setId(-1n);
    removeComponentsFromEntity(entity, ...entity.allComponents);
    removeEntityFromArchetypeArray(entity);
    return entity;
  }

  const getters = {
    /** @returns an array of archetypes and their entities */
    get archetypes() {
      return Array.from(archetypes.entries());
    },

    /** @returns an array of components in the world */
    get components() {
      return Array.from(components.values());
    },

    /** @returns the world component */
    get component(): Component<WorldComponent> {
      return worldComponent;
    },

    /** @returns an array of entities in the world */
    get entities() {
      return Array.from(entities.values());
    },

    /** @returns the world entity */
    get entity() {
      return worldEntity;
    },

    /** @returns an array of systems in the world */
    get systems() {
      return Array.from(systems);
    },
  };

  /**
   * Create a new entity
   * @returns a new entity
   */
  const createEntity = function(): Entity {
    const entity = entityPool.get();
    entity._setId(entityCount);
    entities.set(entityCount, entity);
    addEntityToArchetypeArray(entity);
    ++entityCount;
    return entity;
  };

  /**
   * Remove an entity from the world
   * and disassociate it from any components in the world
   * @param entity the entity to remove
   * @returns true if removed, false if entity not found
   */
  const removeEntity = function(entity: Entity): boolean {
    const b = entities.delete(entity.id);
    if (b) {
      entityPool.release(entity);
    }
    return b;
  };

  /**
   * Create a new component
   * @param spec the component's specification object
   * @returns the created component
   */
  const createComponent = function<T>(spec: ComponentSpec<T>): Component<T> {
    if (maxComponents && componentCount > maxComponents) {
      throw new Error('Maximum component count reached.');
    }
    const component = _createComponent({...spec, id: componentCount});
    components.set(component.name, component);
    ++componentCount;
    return component;
  };

  /**
   * Remove a component from the world
   * and disassociate it from any entities
   * @param component the component to remove
   * @returns true if removed, false if component not found
   */
  const removeComponent = function<T>(component: Component<T>): boolean {
    const b = components.delete(component.name);
    if (b) {
      component.entities.forEach((entity) => removeComponentsFromEntity(entity, component));
    }
    return b;
  };

  /**
   * Associate components with an entity
   * @param entity the entity to add components to
   * @param components one or more component objects
   */
  const addComponentsToEntity = function(entity: Entity, ...components: Component<unknown>[]): Entity {
    removeEntityFromArchetypeArray(entity);
    components.forEach((component) => {
      component._addEntity(entity);
      entity._addComponent(component);
    });
    addEntityToArchetypeArray(entity);
    return entity;
  };

  /**
   * Disassociate components from an entity
   * @param entity the entity to remove components from
   * @param components one or more component objects
   */
  const removeComponentsFromEntity = function(entity: Entity, ...components: Component<unknown>[]): Entity {
    removeEntityFromArchetypeArray(entity);
    components.forEach((component) => {
      component._removeEntity(entity);
      entity._removeComponent(component);
    });
    addEntityToArchetypeArray(entity);
    return entity;
  };

  /**
   * Create an new system
   * @param spec the system's specification object
   * @param idx optional execution index (i.e. 0 gets called first);
   * @returns the created system
   */
  const createSystem = function(spec: SystemSpec, idx?: number): System {
    const system = _createSystem({...spec, id: systemCount});
    if (idx !== undefined) {
      systems.splice(idx, 0, system);
    } else {
      systems.push(system);
    }
    ++systemCount;
    return system;
  };

  /**
   * Remove a system from the world
   * @param system the system to remove
   * @returns true if remove, false if system not found
   */
  const removeSystem = function(system: System): boolean {
    const idx = systems.indexOf(system);
    if (idx > -1) {
      systems.splice(idx, 1);
      return true;
    }
    return false;
  };

  /**
   * Call update on all systems
   * @param dt frame delta time
   */
  const update = function(dt: number): void {
    // for loops might be out of fashion,
    // but they're much faster than reduce
    const acs = Array.from(archetypes.entries());
    const aLen = acs.length - 1;
    const sLen = systems.length - 1;
    const entities = [] as Entity[];
    for (let i = sLen; i >= 0; i--) {
      const system = systems[i];
      if (system.enabled === false) continue;
      for (let j = aLen; j >= 0; j--) {
        const [arch, ents] = acs[j];
        if ((system.archetype & arch) === system.archetype) {
          entities.push(...ents);
        }
      }
      system.update(dt, entities);
      entities.length = 0;
    }
  };

  /**
   * Call render on all systems
   * @param int frame interpolation
   */
  const render = function(int: number): void {
    // for loops might be out of fashion,
    // but they're much faster than reduce
    const acs = Array.from(archetypes.entries());
    const aLen = acs.length - 1;
    const sLen = systems.length - 1;
    const entities = [] as Entity[];
    for (let i = sLen; i >= 0; i--) {
      const system = systems[i];
      if (system.enabled === false) continue;
      for (let j = aLen; j >= 0; j--) {
        const [arch, ents] = acs[j];
        if ((system.archetype & arch) === system.archetype) {
          entities.push(...ents);
        }
      }
      system.render(int, entities);
      entities.length = 0;
    }
  };

  // create worldEntity
  worldEntity = createEntity();

  const world: World = Object.freeze(
    Object.assign(
      getters,
      {
        createEntity,
        removeEntity,
        createComponent,
        removeComponent,
        addComponentsToEntity,
        removeComponentsFromEntity,
        createSystem,
        removeSystem,
        update,
        render,
      }
    )
  );

  // worldEntity setup - ensures archetype 1n is always just the worldEntity
  worldComponent = createComponent<WorldComponent>({
    name: "world",
    entityLimit: 1,
    properties: {
      world,
    },
  });
  addComponentsToEntity(worldEntity, worldComponent);

  return world;
}


