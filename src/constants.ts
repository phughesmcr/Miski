import { version } from "../deno.json" with { type: "json" };

/** The version of the library */
export const VERSION = version;

/** The symbol used to store the system's init function */
export const $_SYSTEM_INIT_KEY = Symbol("$_SYSTEM_INIT_KEY");

/** The symbol used to store the system's destroy function */
export const $_SYSTEM_DESTROY_KEY = Symbol("$_SYSTEM_DESTROY_KEY");

