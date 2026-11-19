import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import { SpecError } from "@/errors.ts";
import { Query } from "@/query/query.ts";
import type { ComponentInstances, ComponentMap } from "@/types/component.ts";
import type {
  SystemArgCount,
  SystemHook,
  SystemInstance,
  SystemPrivateMethods,
  SystemSpec,
  TypedSystemCallback,
} from "@/types/system.ts";
import type { SystemBindings } from "@/types/system.ts";
import type { UntypedQueryComponents } from "@/types/query.ts";
import type { BorrowedEntityList } from "@/entity/entity.ts";
import { isObject, isValidName, noop } from "@/utils.ts";

/**
 * The `argCount` values a system spec may declare. Keyed by {@link SystemArgCount}, so the compiler rejects a key
 * missing from the type or a type member missing here: the runtime check and the type cannot drift apart.
 */
const SYSTEM_ARG_COUNTS: Readonly<Record<SystemArgCount, true>> = { 0: true, 1: true, 2: true, 3: true, 4: true };

/** Untyped view of a system callback, used only to forward calls. */
type ForwardedCallback = (components: unknown, entities: BorrowedEntityList, ...args: unknown[]) => unknown;

/**
 * Create a system instance
 *
 * A query with only `none` terms exposes no components, so its callback receives an empty components record
 * alongside the matching entities.
 *
 * Without `argCount` the instance forwards the caller's arguments exactly through rest/spread, which allocates
 * an arguments array per call; V8 may or may not optimise that away. With `argCount` it has that many fixed
 * parameters and forwards exactly that many, which does not allocate.
 * @param bindings The world bindings used to resolve query data
 * @param system The system to create the instance of
 * @returns The created system instance
 * @throws {NotRegisteredError} If a component in the system query is not registered in the world
 */
export function createSystemInstance<
  TComponents extends ComponentMap,
  TArgs extends unknown[],
  TReturn,
>(
  bindings: SystemBindings,
  system: System<TComponents, TArgs, TReturn>,
): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>> {
  const components = bindings.queryComponents(system.query) as ComponentInstances<TComponents>;
  const callback = system.callback as unknown as ForwardedCallback;
  const query = system.query;

  // One function literal per arity, so each wrapper keeps its own monomorphic call feedback.
  let instance: (...args: never[]) => unknown;
  switch (system.argCount) {
    case undefined:
      instance = (...args: unknown[]) => callback(components, bindings.queryEntityList(query), ...args);
      break;
    case 0:
      instance = () => callback(components, bindings.queryEntityList(query));
      break;
    case 1:
      instance = (a: unknown) => callback(components, bindings.queryEntityList(query), a);
      break;
    case 2:
      instance = (a: unknown, b: unknown) => callback(components, bindings.queryEntityList(query), a, b);
      break;
    case 3:
      instance = (a: unknown, b: unknown, c: unknown) => callback(components, bindings.queryEntityList(query), a, b, c);
      break;
    case 4:
      instance = (a: unknown, b: unknown, c: unknown, d: unknown) =>
        callback(components, bindings.queryEntityList(query), a, b, c, d);
      break;
    default:
      throw new SpecError(`Invalid system argCount: ${String(system.argCount)}`);
  }
  return instance as unknown as SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>;
}

/**
 * Test if a value is a valid system `argCount`
 * @param argCount The value to test
 * @returns `true` if `argCount` is one of the {@link SystemArgCount} values
 */
function isValidArgCount(argCount: unknown): argCount is SystemArgCount {
  return Number.isInteger(argCount) && Object.hasOwn(SYSTEM_ARG_COUNTS, argCount as number);
}

/**
 * Test if an object is a valid system specification
 * @internal Not exported from `mod.ts`; the `System` constructor throws `SpecError` for an invalid spec.
 * @param spec The object to test
 * @returns `true` if the object is a valid system specification, `false` otherwise
 */
export function isValidSystemSpec(spec: unknown): spec is SystemSpec {
  if (isObject(spec) === false) return false;
  const { argCount, name, query, callback, destroy, init } = spec;
  if (typeof name !== "string" || !isValidName(name)) return false;
  if ((query instanceof Query) === false) return false;
  if (typeof callback !== "function") return false;
  if (typeof destroy !== "undefined" && typeof destroy !== "function") return false;
  if (typeof init !== "undefined" && typeof init !== "function") return false;
  if (typeof argCount !== "undefined" && !isValidArgCount(argCount)) return false;
  return true;
}

/** Systems are behaviours which affect components. */
export class System<
  TComponents extends ComponentMap = UntypedQueryComponents,
  TArgs extends unknown[] = unknown[],
  TReturn = void,
> implements SystemPrivateMethods {
  /** The function to call when the system is destroyed. */
  readonly [$_SYSTEM_DESTROY_KEY]: SystemHook;

  /** The function to call when the system is initialized. */
  readonly [$_SYSTEM_INIT_KEY]: SystemHook;

  /**
   * The number of arguments the system instance forwards to the callback after the components and entities, or
   * `undefined` to forward exactly what the caller passes. See {@link SystemSpec.argCount}.
   */
  readonly argCount: SystemArgCount | undefined;

  /** The name of the system */
  readonly name: string;

  /** The query which will provide the components and entities to the system. */
  readonly query: Query<TComponents>;

  /** The core function of the system. Invoked when the system runs (see {@link SystemSpec.callback}). */
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
    const { argCount, name, query, callback, destroy = noop, init = noop } = spec;
    this.argCount = argCount;
    this.name = name;
    this.query = query;
    this.callback = callback;
    this[$_SYSTEM_INIT_KEY] = init;
    this[$_SYSTEM_DESTROY_KEY] = destroy;
  }
}
