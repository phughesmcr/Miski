"use strict";

import { ComponentInstance } from "./component.js";
import { createQueryInstance, Query, QueryInstance } from "./query.js";
import { isValidName, spliceOne, systemNoop } from "./utils.js";
import { World } from "./world.js";

/** A function which runs once at the start of each frame */
export type PreFunction = (entities: number[]) => void;

/** A function which runs once at the end of each frame */
export type PostFunction = (
  entities: number[],
  components: Record<string, ComponentInstance<unknown>>,
  alpha?: number
) => void;

/** A system which may be called multiple times per frame */
export type UpdateFunction = (
  entities: number[],
  components: Record<string, ComponentInstance<unknown>>,
  delta?: number
) => void;

/** System specification */
export interface SystemSpec {
  /** The system's label */
  name: string;
  /** A function which runs once at the start of each frame. Defaults to noop. */
  pre?: PreFunction;
  /** A function which runs once at the end of each frame. Defaults to noop. */
  post?: PostFunction;
  /** A system which may be called multiple times per frame. Defaults to noop. */
  update?: UpdateFunction;
}

/** Systems are the base system context */
export interface System {
  /** List of the system's registered instances */
  instances: SystemInstance[];
  /** The system's label */
  name: string;
  /** A function which runs once at the start of each frame */
  pre: PreFunction;
  /** A function which runs once at the end of each frame */
  post: PostFunction;
  /** A system which may be called multiple times per frame */
  update: UpdateFunction;
}

/** System instances are systems that are registered in a world */
export interface SystemInstance extends System {
  /** The state of the system */
  enabled: boolean;
  /** Query or queries associated with this system instance */
  query: QueryInstance;
  /** The world associated with this system instance */
  world: World;
}

/**
 * Create a new component.
 * Takes a `ComponentSpec` and produces a `Component`.
 * Components can then be registered in a world using `registerComponent(world)`.
 * Components can also be recycled using `destroyComponent(component)`.
 * @param spec the component's specification.
 * @returns the component object.
 */
export function createSystem(spec: SystemSpec): System {
  const { name, pre = systemNoop, post = systemNoop, update = systemNoop } = spec;
  if (!isValidName(name)) throw new SyntaxError("System name is invalid.");
  return {
    instances: [],
    name,
    post,
    pre,
    update,
  };
}

/**
 * Register a system in a world.
 * Takes a `System` and produces a `SystemInstance` tied to the given `World`.
 * The instance can be removed from the world later, using `unregisterSystem(world, system)`.
 * @param world the world to register the system in.
 * @param system the system to register in the world.
 * @param query the query to associate with the system instance.
 * @returns the registered system instance.
 */
export function registerSystem(world: World, system: System, query: Query): SystemInstance {
  const { systems } = world;

  const queryInstance = createQueryInstance(world, query);

  let enabled = false;

  const instance = Object.create(system, {
    enabled: {
      get(): boolean {
        return enabled;
      },
      set(val: boolean) {
        enabled = val;
      },
      configurable: false,
      enumerable: true,
    },
    query: {
      value: queryInstance,
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
  }) as SystemInstance;
  system.instances.push(instance);
  systems.push(instance);
  return instance;
}

/**
 * Remove a system from the world.
 * Takes a `SystemInstance` an unregisters it from its `World`.
 * @param system the system instance to unregister.
 * @returns the world object.
 */
export function unregisterSystem(system: SystemInstance): World {
  const { world } = system;
  const { systems } = world;
  const idx = systems.indexOf(system);
  if (idx === undefined) return world;
  spliceOne(systems, idx);
  return world;
}

export function enableSystem(system: SystemInstance): SystemInstance {
  system.enabled = true;
  return system;
}

export function disableSystem(system: SystemInstance): SystemInstance {
  system.enabled = false;
  return system;
}

export function isSystemEnabled(system: SystemInstance): boolean {
  return system.enabled;
}
