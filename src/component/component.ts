import { isSchema, Partition, type PartitionSpec } from "@phughesmcr/partitionedbuffer";
import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import type {
  ComponentConstructor,
  ComponentPrivateMethods,
  ComponentSpec,
  DynamicComponent,
} from "@/types/component.ts";
import { type FieldDescriptor, fieldStorageConstructor, isFieldDescriptor } from "@/schema/field.ts";
import type { FieldSchema, SchemaOrNull } from "@/types/partitions.ts";
import { SpecError } from "@/errors.ts";
import { isPositiveUint32, isValidName } from "@/utils.ts";

type ComponentSpecRuntime<TStorage extends SchemaOrNull> = {
  name: string;
  schema?: FieldSchema<TStorage> | null;
  maxEntities?: number | null;
};

/**
 * Typed-array constructors a component column may use: numeric, number-addressed storage only.
 * BigInt64Array / BigUint64Array (bigint-valued) are rejected at validation instead of failing later at world construction.
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
  Float16Array,
]);

/**
 * Reject PartitionedBuffer's `[Ctor, initial]` column tuple, which Miski does not support.
 * @param owner - Spec kind and name for the message, e.g. `component "position"`
 * @param schema - The declared schema (ignored unless it is an object)
 * @throws {SpecError} If any column is declared as an array
 */
export function assertNoTupleColumns(owner: string, schema: unknown): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return;
  for (const key of Object.keys(schema)) {
    if (Array.isArray((schema as Record<string, unknown>)[key])) {
      throw new SpecError(
        `Invalid ${owner} schema: column "${key}" uses the [Ctor, initial] tuple form, which is not supported. ` +
          "Declare the bare typed-array constructor (e.g. Float32Array); numeric columns start at 0.",
      );
    }
  }
}

/** @returns `true` if `constructor` is a typed-array constructor supported for component columns */
export function isSupportedColumnConstructor(constructor: unknown): boolean {
  return SUPPORTED_COLUMN_CONSTRUCTORS.has(constructor);
}

/** @returns the first schema key whose column constructor is unsupported, or `undefined` */
function findUnsupportedColumn(schema: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(schema)) {
    const property = schema[key];
    if (isFieldDescriptor(property)) continue;
    if (!isSupportedColumnConstructor(property)) return key;
  }
  return undefined;
}

/**
 * Split a logical schema into its numeric entries and its `field.*` entries.
 * @returns `undefined` when the schema is not a non-empty object with valid field names
 */
function splitSchema(
  schema: unknown,
): { numeric: Record<string, unknown>; fields: Record<string, FieldDescriptor> } | undefined {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return undefined;
  const keys = Object.keys(schema);
  if (keys.length === 0) return undefined;
  const numeric: Record<string, unknown> = {};
  const fields: Record<string, FieldDescriptor> = {};
  for (const key of keys) {
    const property = (schema as Record<string, unknown>)[key];
    if (isFieldDescriptor(property)) {
      if (!isValidName(key)) return undefined;
      fields[key] = property;
    } else {
      numeric[key] = property;
    }
  }
  return { numeric, fields };
}

/** @returns `true` if any own entry of `schema` is a `field.*` descriptor */
function hasFieldDescriptor(schema: object): boolean {
  for (const key in schema) {
    if (Object.hasOwn(schema, key) && isFieldDescriptor((schema as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/** @returns `true` if `schema` is a non-empty map of numeric columns and / or `field.*` descriptors */
function isValidFieldSchema(schema: unknown): boolean {
  // Numeric-only schemas take the original validation path, so they never pay for a split copy.
  if (typeof schema === "object" && schema !== null && !hasFieldDescriptor(schema)) return isSchema(schema);
  const split = splitSchema(schema);
  if (split === undefined) return false;
  return Object.keys(split.numeric).length === 0 || isSchema(split.numeric);
}

/**
 * Physical schema handed to the partitioned buffer: numeric columns as declared plus the typed column backing each
 * lowered field (bool / enum / entity), in declaration order. String and object fields are stored outside the
 * buffer. `null` when no typed column remains.
 */
function physicalSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  const physical: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(schema)) {
    const property = schema[key];
    if (isFieldDescriptor(property)) {
      const Ctor = fieldStorageConstructor(property);
      if (Ctor === null) continue;
      physical[key] = Ctor;
    } else {
      physical[key] = property;
    }
    count++;
  }
  return count === 0 ? null : physical;
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
  if (s.schema && !isValidFieldSchema(s.schema)) return false;
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

  /** The declared (logical) schema, including `field.*` descriptors */
  readonly #schema: FieldSchema<TStorage> | null;

  /**
   * Create a new component.
   * @param spec - The component's specification.
   * @throws {SpecError} - If a column uses the unsupported `[Ctor, initial]` tuple form
   * @throws {TypeError} - If the spec is otherwise invalid
   */
  constructor(spec: ComponentSpec<TValue, TStorage>) {
    if (!isValidComponentSpec(spec)) {
      const { name, schema } = (spec ?? {}) as { name?: unknown; schema?: unknown };
      assertNoTupleColumns(`component "${String(name)}"`, schema);
      if (schema && typeof schema === "object" && isValidFieldSchema(schema)) {
        const key = findUnsupportedColumn(schema as Record<string, unknown>);
        if (key !== undefined) {
          throw new TypeError(
            `Invalid component specification: column "${key}" must use a number-valued typed array ` +
              "(Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, " +
              "Float16Array, Float32Array, Float64Array).",
          );
        }
      }
      throw new TypeError("Invalid component specification.");
    }
    const runtimeSpec = spec as ComponentSpecRuntime<TStorage>;

    this.#id = ComponentRuntime.#nextId++;
    const schema = runtimeSpec.schema ?? null;
    this.#partition = new Partition<TStorage>({
      name: runtimeSpec.name,
      schema: schema === null || !hasFieldDescriptor(schema) ?
        schema :
        physicalSchema(schema as Record<string, unknown>),
      maxOwners: runtimeSpec.maxEntities ?? null,
    } as unknown as PartitionSpec<TStorage>);

    this.#schema = schema;
    this.#isTag = !schema;
  }

  /** The maximum number of entities able to equip this component per world */
  get maxEntities(): number | null {
    return this.#partition.maxOwners;
  }

  /** The component's label */
  get name(): string {
    return this.#partition.name;
  }

  /** The component's declared property definitions, including `field.*` descriptors */
  get schema(): FieldSchema<TStorage> | null {
    return this.#schema;
  }

  /** Bytes one entity occupies in the world buffer (string / object fields are stored outside it) */
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
  /** The declared columns: typed-array constructors and `field.*` descriptors. */
  readonly schema: FieldSchema<TStorage> | null;
  /** Bytes one entity occupies in the world buffer (string / object fields are stored outside it). */
  readonly size: number;
  /** Whether the component has no data fields. */
  readonly isTag: boolean;
  /** Runtime string tag. */
  readonly [Symbol.toStringTag]: string;
  /** Preserve the value shape for typed component consumers. */
  readonly __valueType?: TValue;
}

/** A Component is a collection of properties that are stored in a world */
export const Component: ComponentConstructor = ComponentRuntime as unknown as ComponentConstructor;
