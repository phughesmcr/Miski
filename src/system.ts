/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Query } from "./query/query.js";
import type { ComponentRecord } from "./component/manager.js";
import type { Entity } from "./entity.js";
import type { ParametersExceptFirstTwo } from "./utils/utils.js";
import type { World } from "./world.js";

/**
 * A multi-arity function where the first two parameters
 * are the components and entities available to
 * the system respectively.
 */
export type SystemCallback<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> = (components: ComponentRecord, entities: Entity[], ...args: U) => ReturnType<T>;

export interface SystemSpec<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> {
  /** The core function of the system. Called when this.exec is called. */
  system: SystemCallback<T, U>;
  /** The query which will provide the components and entities to the system. */
  query: Query;
}

export class System<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> {
  /** The core function of the system. Called when this.exec is called. */
  system: SystemCallback<T, U>;
  /** The query which will provide the components and entities to the system. */
  query: Query;

  components: ComponentRecord;
  entities: Entity[];

  /**
   * Creates a new system.
   *
   * Systems are the behaviours which affect components.
   *
   * @param spec the system's specification object
   */
  constructor(spec: SystemSpec<T, U>) {
    const { system, query } = spec;
    this.components = {};
    this.entities = [];
    this.system = system;
    this.query = query;
    Object.freeze(this);
  }

  /**
   * Execute (run / call) the system
   * @param world the world to execute the system in
   * @param args arguments to pass to the system's callback function
   * @returns the result of the system's callback function
   */
  exec(world: World, ...args: U) {
    const components = world.getQueryComponents(this.query);
    const entities = world.getQueryEntities(this.query);
    return this.system(components, entities, ...args);
  }
}
