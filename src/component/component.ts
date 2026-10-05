import { isSchema, Partition, type PartitionSpec } from "@phughesmcr/partitionedbuffer";
import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import type {
  ComponentConstructor,
  ComponentPrivateMethods,
  ComponentSpec,
  DynamicComponent,
} from "@/types/component.ts";
import type { Schema, SchemaOrNull } from "@/types/partitions.ts";
import { isPositiveUint32, isValidName } from "@/utils.ts";

type ComponentSpecRuntime<TStorage extends SchemaOrNull> = {
  name: string;
  schema?: Schema<TStorage> | null;
  maxEntities?: number | null;
};

/**
 * Typed-array constructors a component column may use: numeric, number-addressed storage only.
 * BigInt64Array / BigUint64Array (bigint-valued) and Float16Array (absent from the public
 * `TypedArrayConstructor` type) are rejected at validation instead of failing later at world construction.
 */
const SUPPORTED_COLUMN_CONSTRUCTORS: ReadonlySet<unknown> = new Set<unknown>([
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
]);

/** @returns `true` if `constructor` is a typed-array constructor supported for component columns */
export function isSupportedColumnConstructor(constructor: unknown): boolean {
  return SUPPORTED_COLUMN_CONSTRUCTORS.has(constructor);
}

/** @returns the first schema key whose column constructor is unsupported, or `undefined` */
function findUnsupportedColumn(schema: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(schema)) {
    const property = schema[key];
    if (!isSupportedColumnConstructor(Array.isArray(property) ? property[0] : property)) return key;
  }
  return undefined;
}

/**
 * Component specification type guard.
 * @param spec - The component's specification.
 * @returns `true` if the spec is valid, `false` otherwise
 */
export function isValidComponentSpec<
  TValue extends SchemaOrNull,
  TStorage extends SchemaOrNull = TValue,
>(spec: unknown): spec is ComponentSpec<TValue, TStorage> {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as ComponentSpec<TValue, TStorage>;
  if (!isValidName(s.name)) return false;
  if (s.maxEntities != null && !isPositiveUint32(s.maxEntities)) return false;
  if (s.schema && !isSchema(s.schema)) return false;
  if (s.schema && findUnsupportedColumn(s.schema as Record<string, unknown>) !== undefined) return false;
  // Proxy cursor names cannot also be numeric storage columns.
  if (s.schema && (Object.hasOwn(s.schema, "entity") || Object.hasOwn(s.schema, "slot"))) return false;
  return true;
}

/** Component type guard */
function isComponent(component: unknown): component is DynamicComponent {
  return !!(component && component instanceof ComponentRuntime);
}

/** Checks if a value is an array of Components */
export function isValidComponentArray(array: unknown): array is Array<DynamicComponent> {
  if (!Array.isArray(array)) return false;
  for (let i = 0; i < array.length; i++) {
    if (!isComponent(array[i])) return false;
  }
  return true;
}

/**
 * Component implementation used by the {@link Component} constructor.
 *
 * Prefer importing {@link Component} - construct overloads live on that value so
 * bare `new Component({ schema })` infers storage instead of collapsing to `never`.
 */
class ComponentRuntime<
  TValue extends SchemaOrNull = null,
  TStorage extends SchemaOrNull = TValue,
> implements ComponentPrivateMethods<TStorage> {
  /** Next stable id for component definitions */
  static #nextId = 0;

  /** Stable id for this component definition */
  readonly #id: number;

  /** The component's storage partition */
  readonly #partition: Partition<TStorage>;

  /** `true` if the component has no schema */
  readonly #isTag: boolean;

  /**
   * Create a new component.
   * @param spec - The component's specification.
   * @throws {TypeError} - If the spec is invalid
   */
  constructor(spec: ComponentSpec<TValue, TStorage>) {
    if (!isValidComponentSpec(spec)) {
      const schema = (spec as { schema?: unknown } | null | undefined)?.schema;
      if (schema && typeof schema === "object" && isSchema(schema)) {
        const key = findUnsupportedColumn(schema as Record<string, unknown>);
        if (key !== undefined) {
          throw new TypeError(
            `Invalid component specification: column "${key}" must use a number-valued typed array ` +
              "(Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, " +
              "Float32Array, Float64Array).",
          );
        }
      }
      throw new TypeError("Invalid component specification.");
    }
    const runtimeSpec = spec as ComponentSpecRuntime<TStorage>;

    this.#id = ComponentRuntime.#nextId++;
    this.#partition = new Partition<TStorage>({
      name: runtimeSpec.name,
      schema: runtimeSpec.schema as Schema<TStorage> | null,
      maxOwners: runtimeSpec.maxEntities ?? null,
    } as unknown as PartitionSpec<TStorage>);

    this.#isTag = !runtimeSpec.schema;
  }

  /** The maximum number of entities able to equip this component per world */
  get maxEntities(): number | null {
    return this.#partition.maxOwners;
  }

  /** The component's label */
  get name(): string {
    return this.#partition.name;
  }

  /** The component's property definitions */
  get schema(): Schema<TStorage> | null {
    return this.#partition.schema as Schema<TStorage> | null;
  }

  /** The component's size in bytes for a single entity */
  get size(): number {
    return this.#partition.size;
  }

  /** Whether this component is a tag component with no data schema. */
  get isTag(): boolean {
    return this.#isTag;
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "Component";
  }

  /** Internal stable id for this component definition. */
  get [$_COMPONENT_ID_KEY](): number {
    return this.#id;
  }

  /** Internal partition definition used to allocate world-local storage. */
  get [$_PARTITION_KEY](): Partition<TStorage> {
    return this.#partition;
  }
}

/**
 * A Component is a collection of properties that are stored in a world.
 *
 * Construct overloads: tag specs, bare `{ schema }` (infers storage), or
 * explicit `ComponentSpec` / dual generics for branded writes.
 */
export interface Component<
  TValue extends SchemaOrNull = null,
  TStorage extends SchemaOrNull = TValue,
> extends ComponentPrivateMethods<TStorage> {
  /** The maximum number of owners allowed in each world. */
  readonly maxEntities: number | null;
  /** The component's label. */
  readonly name: string;
  /** The declared numeric column constructors. */
  readonly schema: Schema<TStorage> | null;
  /** Bytes occupied by one entity's component data. */
  readonly size: number;
  /** Whether the component has no numeric columns. */
  readonly isTag: boolean;
  /** Runtime string tag. */
  readonly [Symbol.toStringTag]: string;
  /** Preserve the value shape for typed component consumers. */
  readonly __valueType?: TValue;
}

/** A Component is a collection of properties that are stored in a world */
export const Component: ComponentConstructor = ComponentRuntime as unknown as ComponentConstructor;
