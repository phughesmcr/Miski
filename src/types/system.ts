import type { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import type { Query } from "@/query/query.ts";
import type { System } from "@/system/system.ts";
import type { ComponentInstances, ComponentMap, ComponentRecord, DynamicComponentInstance } from "@/types/component.ts";
import type { SchemaOrNull } from "@/types/partitions.ts";
import type { BorrowedEntityList } from "@/entity/entity.ts";
import type { UntypedQueryComponents } from "@/types/query.ts";
import type { WorldContext } from "@/types/world-api.ts";

/**
 * The parameters of a function omitting the first two parameters
 * @author https://stackoverflow.com/a/67605309
 */
export type ParametersExceptFirstTwo<F extends SystemFunction> = Parameters<F> extends [
  unknown,
  unknown,
  ...infer R,
] ? R :
  [];

/**
 * Internal-compatible system function constraint.
 * @internal
 */
export type SystemFunction = (...args: never[]) => unknown;

/**
 * A multi-arity function where the first two parameters
 * are the components and borrowed dense entity list available
 * to the system respectively.
 */
export type SystemCallback = (
  components: ComponentRecord<SchemaOrNull>,
  entities: BorrowedEntityList,
  ...args: unknown[]
) => void | Promise<void>;

/** A typed system callback for component-map based system authoring. */
export type TypedSystemCallback<
  TComponents extends ComponentMap,
  TArgs extends unknown[] = [],
  TReturn = void,
> = (
  components: ComponentInstances<TComponents>,
  entities: BorrowedEntityList,
  ...args: TArgs
) => TReturn;

/** Internal world bindings used while constructing a system instance. */
export type SystemBindings = {
  queryComponents(query: Query): Record<string, DynamicComponentInstance>;
  queryEntityList(query: Query): BorrowedEntityList;
};

/**
 * The second argument of a system's `init` and `destroy` hooks: lifecycle calls attributed to that hook run.
 *
 * The world waits for a pending hook, so a hook that waits on world readiness, world teardown, or a destruction
 * that waits for the hook itself would wait forever. Calls made through this context are known to come from the
 * hook, so while the hook is pending they reject with `WorldStateError` instead, even after an `await`.
 * After the hook settles they behave like the matching world calls.
 */
export type SystemHookContext = {
  /** Whether this hook run is still pending. */
  readonly pending: boolean;
  /** `world.onReady()`, rejecting while this hook is pending. */
  onReady(): Promise<void>;
  /** `world.destroy()`, rejecting while this hook is pending. */
  destroyWorld(): Promise<void>;
  /** `world.systems.destroy()`, rejecting if the destruction would wait for this pending hook. */
  destroySystem<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): Promise<void>;
};

/** A system `init` or `destroy` hook. */
export type SystemHook = (world: WorldContext, hook: SystemHookContext) => void | Promise<void>;

/**
 * The specification for a System.
 * @param TComponents The query's typed component map
 * @param TArgs The parameters of the callback excluding the first two
 */
export type SystemSpec<
  TComponents extends ComponentMap = UntypedQueryComponents,
  TArgs extends unknown[] = unknown[],
  TReturn = void,
> = {
  /** The name of the system */
  name: string;
  /** The query which will provide the components and entities to the system. */
  query: Query<TComponents>;
  /** The core function of the system. Invoked when the registered SystemInstance is called. */
  callback: TypedSystemCallback<TComponents, TArgs, TReturn>;
  /**
   * How many arguments the system instance forwards to the callback after the components and entities (0 to 4).
   *
   * Leave it unset to forward exactly what the caller passes. That form allocates an arguments array on every call
   * (about 32 B plus 8 B per argument in measurements). V8 may optimise it away after tens of thousands of calls,
   * but that is not guaranteed.
   *
   * Set it when a system is called with a fixed number of arguments on a hot path, such as once per frame with
   * `dt`. The instance then forwards exactly `argCount` arguments without allocating: missing arguments arrive as
   * `undefined` (so default parameters still apply), extra arguments are dropped, and the callback's
   * `arguments.length` and rest parameters always see `argCount` arguments.
   */
  argCount?: TArgs["length"] & (0 | 1 | 2 | 3 | 4);
  /**
   * The function to call when the system is initialized.
   * The world waits for it (and `onReady()` includes it), so it must not await `world.onReady()`,
   * `world.destroy()`, or anything else that waits for this hook to finish. Such calls made synchronously in
   * the hook body reject with `WorldStateError`. After an `await` the world cannot tell who is calling, so make
   * them through the second argument ({@link SystemHookContext}), which rejects them for as long as the hook
   * is pending; the same calls on `world` would wait for the hook and never settle.
   */
  init?: SystemHook;
  /**
   * The function to call when the system is destroyed. It only runs for a system whose `init` completed
   * successfully. If the failure of another system's init put the world in the error state, it still runs
   * during `world.destroy()`, with the world in that state. The same restrictions as `init` apply.
   */
  destroy?: SystemHook;
};

/**
 * @internal
 * The private methods of a System
 */
export interface SystemPrivateMethods {
  [$_SYSTEM_INIT_KEY]: SystemHook;
  [$_SYSTEM_DESTROY_KEY]: SystemHook;
}

/**
 * A SystemInstance is the System.callback bound to the world
 *
 * SystemInstances are convenience functions that memoize the components and entities for the system
 *
 * @param T The callback's type
 * @param U The parameters of the callback excluding the first two (which are always the components and entities)
 */
export type SystemInstance<
  T extends SystemFunction,
  TReturn = ReturnType<T>,
  TArgs extends ParametersExceptFirstTwo<T> = ParametersExceptFirstTwo<T>,
> = (
  ...args: TArgs
) => TReturn;

/** A Record of SystemInstances by System name */
export type SystemRecord = Readonly<Record<string, SystemInstance<SystemCallback>>>;
