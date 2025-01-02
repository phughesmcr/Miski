/**
 * @module      constants
 * @description Constant values used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { version } from "../deno.json" with { type: "json" };
import { randomHexString } from "./utils.ts";

/**
 * @public
 * The version of the library
 */
export const VERSION = version;

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
 * The symbol used to store the component's partition
 */
export const $_PARTITION_KEY: unique symbol = Symbol(`$_PARTITION_KEY_${randomHexString()}`);

/**
 * @internal
 * The symbol used to store the system's init function
 */
export const $_SYSTEM_INIT_KEY: unique symbol = Symbol(`$_SYSTEM_INIT_KEY_${randomHexString()}`);

/**
 * @internal
 * The symbol used to store the system's destroy function
 */
export const $_SYSTEM_DESTROY_KEY: unique symbol = Symbol(`$_SYSTEM_DESTROY_KEY_${randomHexString()}`);
