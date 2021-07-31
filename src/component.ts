"use strict";

import { updateEntityArchetype } from "./archetype.js";
import { Entity } from "./entity.js";
import { Bitmask, createBitmask, setBitOn } from "./mask.js";
import {
  createDataStorage,
  DataStore,
  DataStoreInstance,
  isValidSchema,
  resetDataInStore,
  Schema,
  setDataInStore,
} from "./schema.js";
import { indexOf, isValidName } from "./utils.js";
import { World } from "./world.js";

/**
 * Create a new bitmask from a set of component IDs
 * @param world the world to associate this mask with
 * @param components components to create a mask from
 * @returns a new bitmask
 */
export async function createBitmaskFromComponents(
  world: World,
  ...components: ComponentInstance<unknown>[]
): Promise<Bitmask> {
  const mask = createBitmask(world.spec.maxComponents || 32);
  if (!components.length) return mask;
  const _add = <T>(component: ComponentInstance<T>) => {
    if (component.world.id !== world.id) {
      throw new Error("Components are not from the same world.");
    }
    setBitOn(mask, component.id);
  };
  await Promise.all(components.map(_add));
  return mask;
}

export interface ComponentSpec<T> {
  /** The component's label */
  name: string;
  /** The component's property definitions */
  schema: Schema<T>;
}

/** Components are the base component context */
export interface Component<T> extends ComponentSpec<T> {
  /** Register of instances of this component */
  instances: ComponentInstance<T>[];
}

/** ComponentInstances are Components which have been registered in a world */
export type ComponentInstance<T> = Component<T> & {
  entities: Set<Entity>;
  id: number;
  world: World;
} & { [K in keyof T]: DataStore<T[K], unknown> };

/**
 * Create a new component.
 * Takes a `ComponentSpec` and produces a `Component`.
 * Components can then be registered in a world using `registerComponent(world, component)`.
 * @param spec the component's specification.
 * @returns the component object.
 */
export function createComponent<T>(spec: ComponentSpec<T>): Component<T> {
  if (!spec) throw new SyntaxError("Component creation requires a specification object.");
  const { name, schema } = spec;
  if (!isValidName(name)) throw new SyntaxError("Component name is invalid.");
  if (!isValidSchema(schema)) throw new SyntaxError("Component schema is invalid.");
  return {
    instances: [],
    name,
    schema,
  };
}

/**
 * Register a component in a world.
 * Takes a `Component` and produces a `ComponentInstance` tied to the given `World`.
 * The instance can be removed from the world later, using `unregisterComponent(world, component)`.
 * @param world the world to register the component in.
 * @param component the component to register in the world.
 * @returns the registered component instance.
 */
export async function registerComponent<T>(world: World, component: Component<T>): Promise<ComponentInstance<T>> {
  if (!world) throw new SyntaxError("Component registration requires a World object.");
  if (!component) throw new SyntaxError("Component registration requires a Component object.");
  const { instances, name, schema } = component;
  const { components } = world;
  if (name in components) {
    throw new Error(`Component with name "${name}" is already registered.`);
  }
  // get id
  const idx = await indexOf(components, undefined);
  if (idx === -1) throw new Error("Maximum components reached.");
  // create instance
  const instance = Object.create(component, {
    entities: {
      value: new Set(),
      enumerable: true,
    },
    id: {
      value: idx,
      configurable: false,
      enumerable: true,
      writeable: false,
    },
    world: {
      value: world,
      configurable: false,
      enumerable: true,
      writeable: false,
    },
  }) as ComponentInstance<T>;
  // add schema keys
  const _defineKey = ([key, value]: [string, unknown]) => {
    if (!isValidName(key)) {
      throw new SyntaxError(`Property name "${String(key)}" is invalid or forbidden.`);
    }
    Object.defineProperty(instance, key, {
      value: createDataStorage(world, value as DataStoreInstance<never, never>),
      configurable: false,
      enumerable: true,
      writable: false,
    });
  };
  await Promise.all(Object.entries(schema).map(_defineKey));
  // register
  instances.push(instance);
  components[idx] = instance;
  return instance;
}

/**
 * Remove a component from the world.
 * Takes a `ComponentInstance` an unregisters it from its `World`.
 * @param component the component instance to unregister.
 * @returns the world object.
 */
export async function unregisterComponent<T>(component: ComponentInstance<T>): Promise<World> {
  if (!component) throw new SyntaxError("Component instance required.");
  const { id, name, world } = component;
  const { components } = world;
  const instance = components[id];
  if (!instance || component !== instance) {
    throw new Error(`Component "${name}" does not exist in this world.`);
  }
  const _removeEntity = (entity: Entity) => removeComponentFromEntity(instance, entity);
  await Promise.all([...instance.entities].map(_removeEntity));
  delete components[id];
  return world;
}

/**
 * Gives a component to an entity.
 * @param component the component instance to add to the entity
 * @param entity the entity to add the component to
 * @param properties optional initial properties to set
 * @returns the component instance
 */
export async function addComponentToEntity<T>(
  component: ComponentInstance<T>,
  entity: Entity,
  properties?: T
): Promise<ComponentInstance<T>> {
  if (!component) throw new SyntaxError("Component instance required.");
  if (typeof entity !== "number") throw new SyntaxError("Invalid or undefined entity provided.");
  const { id, name, schema, world } = component;
  const { spec, components } = world;
  if (entity < 0 || entity > spec.maxEntities) {
    throw new Error(`Invalid entity provided: "${entity}".`);
  }
  const instance = components[id] as ComponentInstance<T>;
  if (!instance || component !== instance) {
    throw new Error(`Component "${name}" does not exist in this world.`);
  }
  if (instance.entities.has(entity)) {
    throw new Error(`Entity "${entity}" already has component "${name}".`);
  }
  instance.entities.add(entity);
  if (properties) {
    const _resetData = (key: string) => setDataInStore(instance[key as never], entity, properties[key as keyof T]);
    await Promise.all(Object.keys(schema).map(_resetData));
  }
  await updateEntityArchetype(world, entity, instance, false);
  return component;
}

/**
 * Removes a component from an entity, deleting its properties
 * @param component the component instance to remove
 * @param entity the entity to remove the component from
 * @returns the component instance
 */
export async function removeComponentFromEntity<T>(
  component: ComponentInstance<T>,
  entity: Entity
): Promise<ComponentInstance<T>> {
  if (!component) throw new SyntaxError("Component instance required.");
  if (typeof entity !== "number") throw new SyntaxError("Invalid or undefined entity provided.");
  const { id, name, schema, world } = component;
  const { spec, components } = world;
  if (entity < 0 || entity > spec.maxEntities) {
    throw new Error(`Invalid entity provided: "${entity}".`);
  }
  const instance = components[id];
  if (instance === undefined || component !== instance) {
    throw new Error(`Component "${name}" does not exist in this world.`);
  }
  if (!instance.entities.has(entity)) {
    throw new Error(`Entity "${entity}" does not have component "${name}" to remove.`);
  }
  instance.entities.delete(entity);
  const _resetData = (key: string) => resetDataInStore(instance[key as never], entity);
  await Promise.all(Object.keys(schema).map(_resetData));
  await updateEntityArchetype(world, entity, component, true);
  return component;
}
