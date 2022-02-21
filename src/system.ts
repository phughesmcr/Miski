/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { ParametersExceptFirst } from "./utils.js";
import { World } from "./world.js";

/** A multi-arity function where the first parameter is always the World object */
export type System<T extends (world: World, ...args: any[]) => ReturnType<T>, U extends ParametersExceptFirst<T>> = (
  world: World,
  ...args: U
) => ReturnType<T>;

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
  T extends (world: World, ...args: any[]) => ReturnType<T>,
  U extends ParametersExceptFirst<T>,
>(callback: System<T, U>) {
  return function (world: World) {
    return function (...args: U): ReturnType<T> {
      return callback(world, ...args);
    };
  };
}
