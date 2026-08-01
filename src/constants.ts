/** @returns a random string (base-36) */
function randomString(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * @public
 * The version of the library
 */
export const VERSION = "1.0.0-alpha.3" as const;

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
 * The minimum capacity for a World
 */
export const MIN_WORLD_CAPACITY = 8 as const;

/**
 * @internal
 * The key used to store the Entity's id
 */
export const ID_KEY = "id" as const;

/**
 * @internal
 * The symbol used to store the component's partition
 */
export const $_PARTITION_KEY: unique symbol = Symbol(`$_PARTITION_KEY_${randomString()}`);

/**
 * @internal
 * The symbol used to store the component definition id
 */
export const $_COMPONENT_ID_KEY: unique symbol = Symbol(`$_COMPONENT_ID_KEY_${randomString()}`);

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
