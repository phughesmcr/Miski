/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import type { ComponentRecord } from "./component/manager.js";
import type { Query } from "./query/query.js";
import type { ParametersExceptFirstTwo } from "./utils/utils.js";
import type { Entity, World } from "./world.js";

/**
 * A multi-arity function where the first two parameters
 * are the components and entities available to
 * the system respectively.
 */
export type SystemCallback<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> = (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: U) => ReturnType<T>;

export interface SystemSpec<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> {
  /** The core function of the system. Called when this.exec is called. */
  system: SystemCallback<T, U>;
  /** The query which will provide the components and entities to the system. */
  query: Query;
}

export class System<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> {
  /** The core function of the system. Called when this.exec is called. */
  system: SystemCallback<T, U>;
  /** The query which will provide the components and entities to the system. */
  query: Query;

  /**
   * Creates a new system.
   *
   * Systems are the behaviours which affect components.
   *
   * @param spec the system's specification object
   */
  constructor(spec: SystemSpec<T, U>) {
    const { system, query } = spec;
    this.system = system;
    this.query = query;
  }

  /**
   * Initialize the system for a given world
   * @param world the world to execute the system in
   * @returns an initialized system function
   */
  init(world: World): (...args: U) => ReturnType<T> {
    const components = world.getQueryComponents(this.query);
    const getEntities = world.getQueryEntities(this.query);
    /**
     * @param args arguments to pass to the system's callback function
     * @returns the result of the system's callback function
     */
    return (...args: U) => this.system(components, getEntities(), ...args);
  }
}
