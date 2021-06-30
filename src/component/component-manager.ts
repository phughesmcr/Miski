/**
 * @name        ComponentManager
 * @description The component manager brokers the relationship between components and entities.
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { Entity } from "../entity/entity-manager";
import { Bitmask, createBitmask, getFirstFree, isBitOn, setBitOff, setBitOn } from "../utils/bitmasks";
import { isObject } from "../utils/objects";
import { World } from "../world";
import { Component, ComponentInstance, createComponentInstance, isComponent, isComponentInstance } from "./component";

/** Map of components and their ID numbers */
export type ComponentRegistry = Record<string, ComponentInstance<unknown>>;

export interface ComponentManager {
  addComponentToEntity: <T>(entity: Entity, component: Component<T>, properties?: Partial<T>) => World;
  collateEntityProperties: (entity: Entity) => Record<string, unknown>;
  entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
  getComponentId: <T>(component: Component<T>) => number | undefined;
  getComponentById: (id: number) => Component<unknown> | undefined;
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getComponents: () => ComponentInstance<unknown>[];
  getEntitiesWithComponent: <T>(component: Component<T>) => Entity[];
  getProperties: <T>(entity: Entity, component: Component<T>) => T | undefined;
  isComponentRegistered: <T>(component: Component<T>) => boolean;
  registerComponent: <T>(component: Component<T>) => ComponentInstance<T>;
  removeComponentFromEntity: <T>(entity: Entity, component: Component<T>) => World;
  stripEntity: (entity: Entity) => void;
  unregisterComponent: <T>(component: Component<T>) => World;
}

/**
 * Convert component instances to a bitmask
 * @param components one or more component instances
 * @returns the component IDs as a bitmask
 */
export function componentsToMask(world: World, ...components: ComponentInstance<unknown>[]): Bitmask {
  if (!world) {
    throw new SyntaxError("componentsToMask: a world object is required.");
  }

  const mask = createBitmask(world.config.maxComponents);

  if (!components || !components.length) {
    return mask;
  }

  components.forEach((component) => {
    // check all worlds are the same
    if (component.world.id !== world.id) {
      throw new SyntaxError("componentsToMask: all components must be from the same world.");
    }
    // set the component bit in the mask
    setBitOn(mask, component.id);
  });

  return mask;
}

function _registerComponent(available: Bitmask, registry: ComponentRegistry, world: World) {
  /**
   * Register a component in this world
   * @param component the component to register
   * @returns the component's id number for this world
   */
  function registerComponent<T>(component: Component<T>): ComponentInstance<T> {
    // are we at max capacity?
    if (Object.keys(registry).length >= world.config.maxComponents) {
      throw new Error("registerComponent: maximum components reached.");
    }
    // is component valid?
    if (isComponent(component) === false) {
      throw new TypeError(`registerComponent: expected Component, found "${typeof component}".`);
    }
    // is component already registered?
    if (component.name in registry) {
      throw new Error(`registerComponent: component "${component.name}" is already registered.`);
    }
    // get id
    const id = getFirstFree(available);
    if (id === undefined) {
      throw new Error("registerComponent: no ids available!");
    }
    // create instance
    const instance = createComponentInstance(component, { id, world });
    // store in registry
    setBitOn(available, id);
    registry[component.name] = instance;
    // done, return component id
    return instance;
  }
  return registerComponent;
}

function _unregisterComponent(available: Bitmask, registry: ComponentRegistry, world: World) {
  /**
   * Unregister a component from the world.
   * Will remove component from all entities.
   * @param component the component to unregister
   * @param onlyIfEmpty if true, will only unregister component if no entities currently have the component added.
   * @returns the world
   */
  function unregisterComponent<T>(component: Component<T> | ComponentInstance<T>, onlyIfEmpty = false): World {
    // is component valid?
    if (!isComponent(component)) {
      throw new TypeError(`unregisterComponent: expected Component, found "${typeof component}".`);
    }
    // is component already registered?
    const entry = registry[component.name];
    if (!entry) {
      throw new Error(`unregisterComponent: component "${component.name}" is not registered.`);
    }
    // remove component from all entities and from registry
    const entities = entry.entities;
    if (onlyIfEmpty === false || entities.length === 0) {
      entities.forEach((entity) => world.removeComponentFromEntity(entity, component));
      setBitOff(available, entry.id);
      delete registry[component.name];
    }
    return world;
  }
  return unregisterComponent;
}

function _addComponentToEntity(registry: ComponentRegistry, world: World) {
  /**
   * Add a component to an entity
   * @param entity the entity to add the component to
   * @param component the component to add
   * @param properties optional properties to add to the component instance
   * @returns the world
   */
  function addComponentToEntity<T>(
    entity: Entity,
    component: Component<T> | ComponentInstance<T> | string,
    properties?: Partial<T>
  ): World {
    // is entity defined?
    if (world.getEntityState(entity) !== 1) {
      throw new Error(`addComponentToEntity: Entity "${entity}" does not exist in this world.`);
    }
    // is component valid?
    if (isComponent(component) === false && isComponentInstance(component) === false && typeof component !== "string") {
      throw new TypeError("addComponentToEntity: Invalid component provided.");
    }
    // get component instance
    const name = typeof component === "string" ? component : component.name;
    const entry = registry[name];
    // is component registered?
    if (!entry) {
      throw new Error(`addComponentToEntity: Component "${name}" is not registered in this world.`);
    }
    // does entity already have component?
    if (isBitOn(entry.entities, entity)) {
      throw new Error(`addComponentToEntity: Entity "${entity}" already has component "${name}".`);
    }
    // add entity to component instance
    if (properties !== undefined && isObject(properties)) {
      Object.keys(properties).forEach((key) => {
        if (key in entry) {
          // @todo for typed arrays check that BYTES_PER_ELEMENT is the same for prop and inst;
          entry[key as never][entity] = properties[key as never];
        } else {
          console.warn(`addComponentToEntity: Key "${key}" does not exist in component "${entry.name}".`);
        }
      });
    }
    // update archetype
    setBitOn(entry.entities, entity);
    world.updateEntityArchetype(entity, entry);
    // done
    return world;
  }
  return addComponentToEntity;
}

function _removeComponentFromEntity(registry: ComponentRegistry, world: World) {
  /**
   * Remove a component from an entity
   * @param entity the entity to remove the component from
   * @param component the component to remove
   * @returns the world
   */
  function removeComponentFromEntity<T>(
    entity: Entity,
    component: ComponentInstance<T> | Component<T> | string
  ): World {
    // is entity active?
    if (!world.getEntityState(entity)) {
      throw new Error(`removeComponentFromEntity: entity "${entity}" is not active in this world.`);
    }
    // is component valid?
    if (isComponent(component) === false && isComponentInstance(component) === false && typeof component !== "string") {
      throw new TypeError("removeComponentFromEntity: invalid component provided.");
    }
    // is component registered?
    const name = typeof component === "string" ? component : component.name;
    const entry = registry[name];
    if (!entry) {
      throw new Error(`removeComponentFromEntity: component "${name}" is not registered in this world.`);
    }
    // does entity already have component?
    if (isBitOn(entry.entities, entity) === false) {
      throw new Error(`removeComponentFromEntity: entity "${entity}" does not have component "${name}" to remove.`);
    }
    // update archetype
    setBitOff(entry.entities, entity);
    world.updateEntityArchetype(entity, entry);
    // done
    return world;
  }
  return removeComponentFromEntity;
}

function _entityHasComponent(registry: ComponentRegistry) {
  /**
   * Check if an entity has a component
   * @param entity the entity to check
   * @param component the component to check for
   * @returns true if the entity has the component
   */
  function entityHasComponent<T>(entity: Entity, component: Component<T> | ComponentInstance<T> | string): boolean {
    const name = typeof component === "string" ? component : component.name;
    const inst = registry[name];
    if (inst === undefined) return false;
    return isBitOn(inst.entities, entity);
  }
  return entityHasComponent;
}

function _getProperties(registry: ComponentRegistry) {
  /**
   * Get the component properties for a given entity
   * @param entity the entity to get the properties of
   * @param component the component to get the properties of
   * @returns the entity's component properties
   */
  function getProperties<T>(entity: Entity, component: Component<T> | ComponentInstance<T> | string): T | undefined {
    const instance = registry[typeof component === "string" ? component : component.name];
    if (instance === undefined) {
      throw new Error("getProperty: component not registered.");
    }
    if (isBitOn(instance.entities, entity) === false) return;
    return instance.getPropertyArrays().reduce((obj, [name, arr]) => {
      (obj as Record<string, unknown>)[name] = arr[entity];
      return obj;
    }, {} as T);
  }
  return getProperties;
}

function _getComponentById(registry: ComponentRegistry) {
  /**
   * Find a component with a given id
   * @param id the component's id to find
   * @returns the found component
   */
  function getComponentById(id: number): Component<unknown> | undefined {
    return [...Object.values(registry)].find((instance) => instance.id === id);
  }
  return getComponentById;
}

function _getComponentByName(registry: ComponentRegistry) {
  /**
   * Find a component with a given name
   * @param name the component's name to find
   * @returns the found component
   */
  function getComponentByName(name: string): ComponentInstance<unknown> | undefined {
    return registry[name];
  }
  return getComponentByName;
}

function _getComponents(registry: ComponentRegistry) {
  /** @returns an array of all registered components */
  function getComponents(): ComponentInstance<unknown>[] {
    return [...Object.values(registry)];
  }
  return getComponents;
}

function _isComponentRegistered(registry: ComponentRegistry) {
  /** @returns true if a component is registered in this world */
  function isComponentRegistered<T>(component: Component<T> | ComponentInstance<T> | string): boolean {
    return (typeof component === "string" ? component : component.name) in registry;
  }
  return isComponentRegistered;
}

function _getEntitiesWithComponent(registry: ComponentRegistry) {
  /** @returns an array of entities with a given component */
  function getEntitiesWithComponent<T>(component: Component<T> | ComponentInstance<T> | string): Entity[] {
    const entry = registry[typeof component === "string" ? component : component.name];
    if (!entry) return [];
    return [...entry.entities];
  }
  return getEntitiesWithComponent;
}

function _collateEntityProperties(registry: ComponentRegistry) {
  const getProperties = _getProperties(registry);
  /** @returns an object of all component properties associated with an entity */
  function collateEntityProperties(entity: Entity): Record<string, unknown> {
    return Object.keys(registry).reduce((obj, name) => {
      obj[name] = getProperties(entity, name);
      return obj;
    }, {} as Record<string, unknown>);
  }
  return collateEntityProperties;
}

function _getComponentId(registry: ComponentRegistry) {
  /** @returns the id of a given component */
  function getComponentId<T>(component: Component<T> | ComponentInstance<T> | string): number | undefined {
    return registry[typeof component === "string" ? component : component.name]?.id;
  }
  return getComponentId;
}

function _stripEntity(registry: ComponentRegistry, world: World) {
  /** A faster way to remove all components from an entity at once */
  function stripEntity(entity: Entity): void {
    // strip archetype
    world.resetEntityArchetype(entity);
    // strip components
    Object.values(registry).forEach((instance) => setBitOff(instance.entities, entity));
  }
  return stripEntity;
}

export function createComponentManager(world: World): ComponentManager {
  const { maxComponents } = world.config;

  const availableIds: Bitmask = createBitmask(maxComponents);

  const registry: ComponentRegistry = {};

  return {
    addComponentToEntity: _addComponentToEntity(registry, world),
    collateEntityProperties: _collateEntityProperties(registry),
    entityHasComponent: _entityHasComponent(registry),
    getComponentById: _getComponentById(registry),
    getComponentByName: _getComponentByName(registry),
    getComponentId: _getComponentId(registry),
    getComponents: _getComponents(registry),
    getEntitiesWithComponent: _getEntitiesWithComponent(registry),
    getProperties: _getProperties(registry),
    isComponentRegistered: _isComponentRegistered(registry),
    registerComponent: _registerComponent(availableIds, registry, world),
    removeComponentFromEntity: _removeComponentFromEntity(registry, world),
    stripEntity: _stripEntity(registry, world),
    unregisterComponent: _unregisterComponent(availableIds, registry, world),
  };
}
