import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import { NoComponentsFoundError, SpecError } from "@/errors.ts";
import { Query } from "@/query/query.ts";
import type { ComponentInstances, ComponentMap } from "@/types/component.ts";
import type { BorrowedEntityList } from "@/entity/entity.ts";
import type { SystemInstance, SystemPrivateMethods, SystemSpec, TypedSystemCallback } from "@/types/system.ts";
import type { SystemBindings } from "@/types/system.ts";
import type { UntypedQueryComponents } from "@/types/query.ts";
import type { WorldContext } from "@/types/world-api.ts";
import { isObject, isValidName, noop } from "@/utils.ts";

/**
 * Create a system instance
 * @param bindings The world bindings used to resolve query data
 * @param system The system to create the instance of
 * @returns The created system instance
 * @throws {NoComponentsFoundError} If the system query returned no components
 */
type CallableSystem<
  TComponents extends ComponentMap,
  TArgs extends unknown[],
  TReturn,
> = (
  components: ComponentInstances<TComponents>,
  entities: BorrowedEntityList,
  ...args: TArgs
) => TReturn;

export function createSystemInstance<
  TComponents extends ComponentMap,
  TArgs extends unknown[],
  TReturn,
>(
  bindings: SystemBindings,
  system: System<TComponents, TArgs, TReturn>,
): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>> {
  const components = bindings.queryComponents(system.query) as ComponentInstances<TComponents>;
  const callback = system.callback as CallableSystem<TComponents, unknown[], TReturn>;
  const query = system.query;

  if (Object.keys(components).length === 0) {
    throw new NoComponentsFoundError("System query returned no components");
  }

  // Fixed-arity forwarder: no rest/spread on the hot path, and no dependence on
  // `callback.length` (which would break trailing default parameters).
  // Four user-arg slots covers current call sites; omitted args stay `undefined`,
  // so callback defaults still apply.
  return ((arg0?: unknown, arg1?: unknown, arg2?: unknown, arg3?: unknown) =>
    callback(
      components,
      bindings.queryEntityList(query),
      arg0,
      arg1,
      arg2,
      arg3,
    )) as unknown as SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>;
}

/**
 * Test if an object is a valid system specification
 * @param spec The object to test
 * @returns `true` if the object is a valid system specification, `false` otherwise
 */
export function isValidSystemSpec(spec: unknown): spec is SystemSpec {
  if (isObject(spec) === false) return false;
  const { name, query, callback, destroy, init } = spec;
  if (typeof name !== "string" || !isValidName(name)) return false;
  if ((query instanceof Query) === false) return false;
  if (typeof callback !== "function") return false;
  if (typeof destroy !== "undefined" && typeof destroy !== "function") return false;
  if (typeof init !== "undefined" && typeof init !== "function") return false;
  return true;
}

/** Systems are behaviours which affect components. */
export class System<
  TComponents extends ComponentMap = UntypedQueryComponents,
  TArgs extends unknown[] = unknown[],
  TReturn = void,
> implements SystemPrivateMethods {
  /** The function to call when the system is destroyed. */
  readonly [$_SYSTEM_DESTROY_KEY]: (world: WorldContext) => void | Promise<void>;

  /** The function to call when the system is initialized. */
  readonly [$_SYSTEM_INIT_KEY]: (world: WorldContext) => void | Promise<void>;

  /** The name of the system */
  readonly name: string;

  /** The query which will provide the components and entities to the system. */
  readonly query: Query<TComponents>;

  /** The core function of the system. Invoked when the registered SystemInstance is called. */
  readonly callback: TypedSystemCallback<TComponents, TArgs, TReturn>;

  /**
   * Creates a new system.
   *
   * Systems are the behaviours which affect components.
   *
   * @param spec the system's specification object
   * @throws {SpecError} If the system specification is invalid
   */
  constructor(spec: SystemSpec<TComponents, TArgs, TReturn>) {
    if (isValidSystemSpec(spec) === false) {
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
