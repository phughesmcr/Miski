/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ComponentRecord } from "./component/manager.js";
import { Entity } from "./entity.js";
import { Query } from "./query/query.js";
import { ParametersExceptFirstTwo } from "./utils/utils.js";
import { World } from "./world.js";

/** A multi-arity function where the first parameter is always the World object */
export type System<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> = (components: ComponentRecord, entities: Entity[], ...args: U) => ReturnType<T>;

/**
 * Creates a new curried System function
 * @param system the System function to be called
 * @returns a curried function (world) => (...args) => result;
 *
 * @example
 * const logQuery = createQuery({ all: [loggable]});
 * const log = (components: Record<string, ComponentInstance>, entities: Entity[], value: string) => console.log(value);
 * const logSystem = createSystem(log, logQuery);
 * const logSystemInstance = logSystem(world);
 * logSystemInstance("hello, world!"); // hello, world!
 */
export function createSystem<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
>(system: System<T, U>, query: Query) {
  return (world: World) => {
    const [getEntities, components] = world.getQueryResult(query);
    return (...args: U): ReturnType<T> => system(components, getEntities(), ...args);
  };
}
