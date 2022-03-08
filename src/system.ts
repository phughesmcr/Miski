/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ComponentRecord } from "./component/component.js";
import { Entity } from "./entity.js";
import { Query } from "./query/query.js";
import { ParametersExceptFirst } from "./utils.js";
import { World } from "./world.js";

/** A multi-arity function where the first parameter is always the World object */
export type System<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirst<T>,
> = (components: ComponentRecord, entities: Entity[], ...args: U) => ReturnType<T>;

/**
 * Creates a new curried System function
 * @param callback the System function to be called
 * @returns a curried function (world) => (...args) => result;
 *
 * @example
 * const world = {} as World;
 * const log = (world: World, value: string) => console.log(value);
 * const logSystem = createSystem(log);
 * const logSystemInstance = logSystem(world);
 * logSystemInstance("hello, world!"); // hello, world!
 */
export function createSystem<
  T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirst<T>,
>(callback: System<T, U>, query: Query) {
  return function (world: World) {
    const [getEntities, components] = world.getQueryResult(query);
    return function (...args: U): ReturnType<T> {
      return callback(components, getEntities(), ...args);
    };
  };
}
