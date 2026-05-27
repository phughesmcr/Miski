import { isValidName } from "@phughesmcr/partitionedbuffer";
import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import { NoComponentsFoundError, SpecError } from "@/errors.ts";
import { Query } from "@/query/query.ts";
import type {
  BorrowedEntityList,
  ComponentInstances,
  ComponentMap,
  SystemInstance,
  SystemPrivateMethods,
  SystemSpec,
  TypedSystemCallback,
  TypedSystemSpec,
  UntypedQueryComponents,
} from "@/types.ts";
import { isObject, noop } from "@/utils.ts";
import type { World } from "@/world/world.ts";

/**
 * Create a system instance
 * @param world The world to create the system instance in
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
  world: World,
  system: System<TComponents, TArgs, TReturn>,
  queryComponents: (query: Query) => Record<string, unknown> = (query) => world.components.query(query),
): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>> {
  const components = queryComponents(system.query) as ComponentInstances<TComponents>;
  const callback = system.callback as CallableSystem<TComponents, TArgs, TReturn>;

  if (Object.keys(components).length === 0) {
    throw new NoComponentsFoundError("System query returned no components");
  }

  const boundCallback = ((...args: TArgs) => {
    return callback(components, world.entities.queryList(system.query), ...args);
  }) as unknown as SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>;
  return boundCallback;
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

/** Define a typed system from keyed component maps. */
export function defineSystem<
  const TAll extends ComponentMap = Record<never, never>,
  const TAny extends ComponentMap = Record<never, never>,
  const TNone extends ComponentMap = Record<never, never>,
  TArgs extends unknown[] = [],
  TReturn = void,
>(
  spec: TypedSystemSpec<TAll, TAny, TNone, TArgs, TReturn>,
): System<TAll & TAny, TArgs, TReturn> {
  const { name, all = {}, any = {}, none = {}, callback, destroy, init } = spec;
  return new System({
    name,
    query: new Query({ all, any, none }) as Query<TAll & TAny>,
    callback,
    destroy,
    init,
  });
}

/** Systems are behaviours which affect components. */
export class System<
  TComponents extends ComponentMap = UntypedQueryComponents,
  TArgs extends unknown[] = unknown[],
  TReturn = void,
> implements SystemPrivateMethods {
  /** The function to call when the system is destroyed. */
  readonly [$_SYSTEM_DESTROY_KEY]: (world: World) => void | Promise<void>;

  /** The function to call when the system is initialized. */
  readonly [$_SYSTEM_INIT_KEY]: (world: World) => void | Promise<void>;

  /** The name of the system */
  readonly name: string;

  /** The query which will provide the components and entities to the system. */
  readonly query: Query<TComponents>;

  /** The core function of the system. Called when this.exec is called. */
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
