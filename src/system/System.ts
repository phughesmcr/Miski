import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "../constants.ts";
import { isObject, noop } from "../utils.ts";
import { isValidName } from "@phughesmcr/partitionedbuffer";
import { Query } from "../query/Query.ts";
import { NoComponentsFoundError, SpecError } from "../errors.ts";
import type {
  ComponentRecord,
  Entity,
  ParametersExceptFirstTwo,
  SystemCallback,
  SystemInstance,
  SystemSpec,
} from "../types.ts";
import type { World } from "../world/World.ts";

/**
 * Create a system instance
 * @param world The world to create the system instance in
 * @param system The system to create the instance of
 * @returns The created system instance
 * @throws {NoComponentsFoundError} If the system query returned no components
 */
export function createSystemInstance<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
>(world: World, system: System<T, U>): SystemInstance<T, U> {
  const components = world.components.query(system.query);
  if (Object.keys(components).length === 0) {
    throw new NoComponentsFoundError("System query returned no components");
  }
  const entities = world.entities.query(system.query);
  const boundCallback = system.callback.bind(null, components, entities);
  return Object.setPrototypeOf(boundCallback, system);
}

/**
 * Test if an object is a valid system specification
 * @param spec The object to test
 * @returns `true` if the object is a valid system specification, `false` otherwise
 */
// deno-lint-ignore no-explicit-any
export function isValidSystemSpec(spec: unknown): spec is SystemSpec<any, any> {
  if (!isObject(spec)) return false;
  const { name, query, callback, destroy, init } = spec;
  if (typeof name !== "string" || !isValidName(name)) return false;
  if (!(query instanceof Query)) return false;
  if (typeof callback !== "function") return false;
  if (typeof destroy !== "undefined" && typeof destroy !== "function") return false;
  if (typeof init !== "undefined" && typeof init !== "function") return false;
  return true;
}

/** Systems are behaviours which affect components. */
export class System<
  T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
  U extends ParametersExceptFirstTwo<T>,
> {
  /** The function to call when the system is destroyed. */
  readonly [$_SYSTEM_DESTROY_KEY]: (world: World) => void | Promise<void>;

  /** The function to call when the system is initialized. */
  readonly [$_SYSTEM_INIT_KEY]: (world: World) => void | Promise<void>;

  /** The name of the system */
  readonly name: string;

  /** The query which will provide the components and entities to the system. */
  readonly query: Query;

  /** The core function of the system. Called when this.exec is called. */
  readonly callback: SystemCallback<T, U>;

  /**
   * Creates a new system.
   *
   * Systems are the behaviours which affect components.
   *
   * @param spec the system's specification object
   * @throws {SpecError} If the system specification is invalid
   */
  constructor(spec: SystemSpec<T, U>) {
    if (!isValidSystemSpec(spec)) {
      throw new SpecError("Invalid system specification");
    }
    const { name, query, callback, destroy = noop, init = noop } = spec;
    this.name = name;
    this.query = query;
    this.callback = callback;
    this[$_SYSTEM_INIT_KEY] = init;
    this[$_SYSTEM_DESTROY_KEY] = destroy;
  }
}
