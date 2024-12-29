/**
 * @module      constants
 * @description Constant values used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { version } from "../deno.json" with { type: "json" };

/** The version of the library */
export const VERSION = version;

/** The minimum value for a Uint32 */
export const MIN_UINT32 = 0;

/** The maximum value for a Uint32 */
export const MAX_UINT32 = 0xffffffff;

/** The symbol used to store the system's init function */
export const $_SYSTEM_INIT_KEY = Symbol("$_SYSTEM_INIT_KEY");

/** The symbol used to store the system's destroy function */
export const $_SYSTEM_DESTROY_KEY = Symbol("$_SYSTEM_DESTROY_KEY");
