// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component, ComponentSpec, WorldComponent, _createComponent } from './component';
import { Entity, _createEntity } from './entity';
import { Pool, _createPool } from './pool';
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
  getEntityById(id: bigint): Entity | undefined,
  createComponent<T>(spec: ComponentSpec<T>): Component<T>,
  removeComponent<T>(component: Component<T>): boolean,
  getComponentByName(name: string): Component<unknown> | undefined,
  addComponentsToEntity(entity: Entity, ...components: Component<unknown>[]): Entity,
  removeComponentsFromEntity(entity: Entity, ...components: Component<unknown>[]): Entity,
  createSystem(spec: SystemSpec, idx?: number): System,
  removeSystem(system: System): boolean,
  moveSystem(system: System | string, idx: number): System,
  getSystemByName(name: string): System | undefined,
  preUpdate(): void,
  update(dt: number): void,
  render(int: number): void,
}

export function createWorld(spec: WorldSpec): World {
  // world config
  const {
    initialPoolSize = 10,
    maxComponents = 1024n,
  } = { ...spec };

  /** @private */
  const isComponentRegistered = function<T>(component: Component<T>): boolean {
    return components.get(component.name) === component;
  };

  /** @private **/
  const addEntityToArchetypeArray = function(entity: Entity) {
    if (archetypes.get(entity.archetype) === undefined) {
      archetypes.set(entity.archetype, new Set());
    }
    archetypes.get(entity.archetype)?.add(entity);
  };

  /** @private */
  const removeEntityFromArchetypeArray = function(entity: Entity) {
    archetypes.get(entity.archetype)?.delete(entity);
  };

  /** @private */
  const destroyEntity = function(entity: Entity): Entity {
    entity._setId(-1n);
    removeComponentsFromEntity(entity, ...entity.allComponents);
    removeEntityFromArchetypeArray(entity);
    return entity;
  };

  // constants
  const archetypes = new Map() as Map<bigint, Set<Entity>>;
  const components = new Map() as Map<string, Component<unknown>>;
  const entities = new Map() as Map<bigint, Entity>;
  const systems = [] as System[];
  const entityPool: Pool<Entity> = _createPool({
    create: _createEntity,
    destroy: destroyEntity,
    initialSize: initialPoolSize,
  });

  // variables
  let entityCount = 0n;
  let componentCount = 0n;
  let systemCount = 0n;
  let worldComponent = {} as Component<WorldComponent>;
  let worldEntity = {} as Entity;

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
   * Remove an entity from the world
   * and disassociate it from any components in the world
   * @param entity the entity to remove
   * @returns true if removed, false if entity not found
   */
  const removeEntity = function(entity: Entity): boolean {
    if (!entity) return false;
    const b = entities.delete(entity.id);
    if (b === true) {
      entityPool.release(entity);
    }
    return b;
  };

  /**
   * Find an entity in the world by its id
   * @param id the entity id to search for.
   */
  const getEntityById = function(id: bigint): Entity | undefined {
    return entities.get(id);
  };

  /**
   * Create a new component
   * @param spec the component's specification object
   * @returns the created component
   */
  const createComponent = function<T>(spec: ComponentSpec<T>): Component<T> {
    if (maxComponents !== undefined && componentCount > maxComponents) {
      throw new Error('Maximum component count reached.');
    }
    if (components.has(spec.name)) {
      throw new Error(`component "${spec.name}" already exists.`);
    }
    /** @todo validate input */
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
    if (!component?.name) return false;
    const b = components.delete(component.name);
    if (b === true) {
      component.entities.forEach((entity) => removeComponentsFromEntity(entity, component));
    }
    return b;
  };

  /**
   * Find a component in the world by its name
   * @param name the case-sensitive component name to search for.
   */
  const getComponentByName = function(name: string): Component<unknown> | undefined {
    return components.get(name);
  };

  /**
   * Associate components with an entity
   * @param entity the entity to add components to
   * @param components one or more component objects
   */
  const addComponentsToEntity = function(entity: Entity, ...components: Component<unknown>[]): Entity {
    if (!entity) {
      throw new Error('no entity provided.');
    }
    if (!components?.length) {
      return entity;
    }
    removeEntityFromArchetypeArray(entity);
    components.forEach((component) => {
      if (isComponentRegistered(component) === false) {
        /** @todo add function to avoid this error */
        throw new Error(`component ${component.name} is not registered in this world.`);
      }
      if (component.hasEntity(entity) == false) {
        component._addEntity(entity);
        entity._addComponent(component);
      }
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
    if (!entity) {
      throw new Error('no entity provided.');
    }
    if (!components?.length) {
      return entity;
    }
    removeEntityFromArchetypeArray(entity);
    components.forEach((component) => {
      if (isComponentRegistered(component) === false) {
        throw new Error(`component ${component.name} is not registered in this world.`);
      }
      if (component.hasEntity(entity) == true) {
        component._removeEntity(entity);
        entity._removeComponent(component);
      }
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
    const tmp = getSystemByName(spec.name);
    if (!tmp) {
      const system = _createSystem({...spec, id: systemCount});
      if (idx !== undefined) {
        systems.splice(idx, 0, system);
      } else {
        systems.push(system);
      }
      ++systemCount;
      return system;
    } else {
      throw new Error(`system "${spec.name}" already exists.`);
    }
  };

  /**
   * Remove a system from the world
   * @param system the system to remove
   * @returns true if remove, false if system not found
   */
  const removeSystem = function(system: System): boolean {
    if (!system?.name) return false;
    const idx = systems.indexOf(system);
    if (idx > -1) {
      systems.splice(idx, 1);
      return true;
    }
    return false;
  };

  /**
   * Move a system in the execution order
   * @param system the system to move
   * @param idx the execution array index to move the system to
   */
  const moveSystem = function(system: System, idx: number): System {
    if (!system?.id) {
      throw new Error('no system provided.');
    }
    if (idx === undefined || typeof idx !== 'number') {
      throw new Error('no new index provided.');
    }
    const removed = removeSystem(system);
    if (removed === true) {
      systems.splice(idx, 0, system);
    }
    return system;
  };

  /**
   * Find a system in the world by its name
   * @param name the case-sensitive system name to search for.
   */
  const getSystemByName = function(name: string): System | undefined {
    if (!name) return undefined;
    return systems.find((system) => system.name === name);
  };

  /** Call preUpdateFn on all systems */
  const preUpdate = function(): void {
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
      system.preUpdate(entities);
      entities.length = 0;
    }
  };

  /**
   * Call updateFn on all systems
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
   * Call renderFn on all systems
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

  const world: World = Object.assign(
    getters,
    {
      /**
       * Create a new entity
       * @returns a new entity
       */
      createEntity: function(): Entity {
        const entity = entityPool.get();
        entity._setId(entityCount);
        entity._setWorld(world);
        entities.set(entityCount, entity);
        addEntityToArchetypeArray(entity);
        ++entityCount;
        return entity;
      },
      removeEntity,
      getEntityById,
      createComponent,
      removeComponent,
      getComponentByName,
      addComponentsToEntity,
      removeComponentsFromEntity,
      createSystem,
      removeSystem,
      moveSystem,
      getSystemByName,
      preUpdate,
      update,
      render,
    }
  );

  // create worldEntity
  worldEntity = world.createEntity();

  // worldEntity setup - ensures archetype 1n is always just the worldEntity
  worldComponent = createComponent<WorldComponent>({
    name: "world",
    entityLimit: 1,
    removable: false,
    properties: {
      world,
    },
  });
  addComponentsToEntity(worldEntity, worldComponent);

  return Object.freeze(world);
}


