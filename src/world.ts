// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, ComponentSpec, _createComponent } from './component';
import { Entity, _createEntity } from './entity';
import { _createPool } from './pool';
import { System, SystemSpec, _createSystem } from './system';

interface WorldSpec {
  initialPoolSize?: number | bigint;
  maxComponents?: number | bigint;
}

interface World {
  archetypes: [bigint, Entity[]][],
  components: Component<unknown>[],
  entities: Entity[],
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
    archetypes: new Map() as Map<bigint, Entity[]>,
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
  } = {
    componentCount: 0n,
    entityCount: 0n,
    systemCount: 0n,
  };

  /** @private **/
  const addEntityToArchetypeArray = (entity: Entity) => {
    const archetype = archetypes.get(entity.archetype);
    if (!archetype) {
      archetypes.set(entity.archetype, [entity]);
    } else {
      if (!archetype.includes(entity)) {
        archetype.push(entity);
      }
    }
  };

  /** @private */
  const removeEntityFromArchetypeArray = (entity: Entity) => {
    const archetype = archetypes.get(entity.archetype);
    const idx = archetype?.indexOf(entity);
    if (idx !== undefined && idx > -1) {
      archetype?.splice(idx, 1);
    }
  };

  /** @private */
  function _destroyEntity(entity: Entity): Entity {
    entity._setId(-1n);
    removeComponentsFromEntity(entity, ...entity.allComponents);
    removeEntityFromArchetypeArray(entity);
    return entity;
  }

  const getters = {
    get archetypes() {
      return Array.from(archetypes.entries());
    },

    /** @returns an array of components in the world */
    get components() {
      return Array.from(components.values());
    },

    /** @returns an array of entities in the world */
    get entities() {
      return Array.from(entities.values());
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
    const id = ++entityCount;
    entity._setId(id);
    entities.set(id, entity);
    addEntityToArchetypeArray(entity);
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
    const id = ++componentCount;
    const component = _createComponent({...spec, id});
    components.set(component.name, component);
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
      component.entities.forEach((entity) => entity._removeComponent(component));
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
      entity._addComponent(component);
      component._addEntity(entity);
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
      entity._removeComponent(component);
      component._removeEntity(entity);
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
    const id = ++systemCount;
    const system = _createSystem({...spec, id});
    if (idx !== undefined) {
      systems.splice(idx, 0, system);
    } else {
      systems.push(system);
    }
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
    systems.forEach((system) => {
      if (system.enabled) {
        /** @todo make this more efficient */
        const entities = Array.from(archetypes.entries()).reduce((arr, [archetype, ents]) => {
          if ((system.archetype & archetype) === system.archetype) {
            arr.push(...ents);
          }
          return arr;
        }, [] as Entity[]);
        system.update(dt, entities);
      }
    });
  };

  /**
   * Call render on all systems
   * @param int frame interpolation
   */
  const render = function(int: number): void {
    systems.forEach((system) => {
      if (system.enabled) {
        /** @todo make this more efficient */
        const entities = Array.from(archetypes.entries()).reduce((arr, [archetype, ents]) => {
          if ((system.archetype & archetype) === system.archetype) {
            arr.push(...ents);
          }
          return arr;
        }, [] as Entity[]);
        system.render(int, entities);
      }
    });
  };

  return Object.freeze(
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
}


