/**
 * @module      constants
 * @description Constant values used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { randomString } from "./utils.ts";

/**
 * @public
 * The version of the library
 */
export const VERSION = "0.1.0" as const;

/**
 * @internal
 * The minimum value for a Uint32
 */
export const MIN_UINT32 = 0 as const;

/**
 * @internal
 * The maximum value for a Uint32
 */
export const MAX_UINT32 = 0xffffffff as const;

/**
 * @internal
 * The key used to store the Entity's id
 */
export const ID_KEY = "id" as const;

/**
 * @internal
 * The key used to store the Entity's archetype
 */
export const $_ARCHETYPE_KEY: unique symbol = Symbol(`$_ARCHETYPE_KEY_${randomString()}`);

/**
 * @internal
 * The symbol used to store the component's partition
 */
export const $_PARTITION_KEY: unique symbol = Symbol(`$_PARTITION_KEY_${randomString()}`);

/**
 * @internal
 * The symbol used to store the query's instances
 */
export const $_QUERY_KEY: unique symbol = Symbol(`$_QUERY_KEY_${randomString()}`);

/**
 * @internal
 * The symbol used to store the system's init function
 */
export const $_SYSTEM_INIT_KEY: unique symbol = Symbol(`$_SYSTEM_INIT_KEY_${randomString()}`);

/**
 * @internal
 * The symbol used to store the system's destroy function
 */
export const $_SYSTEM_DESTROY_KEY: unique symbol = Symbol(`$_SYSTEM_DESTROY_KEY_${randomString()}`);

/**
 * @internal
 * The list of invalid names
 */
export const INVALID_NAMES: string[] = [
  "id",
  "$_PARTITION_KEY",
  "$_SYSTEM_INIT_KEY",
  "$_SYSTEM_DESTROY_KEY",
];
