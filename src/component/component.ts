import { isValidName as isValidPartitionName, Partition, type PartitionSpec } from "@phughesmcr/partitionedbuffer";
import { $_COMPONENT_ID_KEY, $_PARTITION_KEY, FLOAT16_ARRAY } from "@/constants.ts";
import type {
  ComponentConstructor,
  ComponentPrivateMethods,
  ComponentSpec,
  DynamicComponent,
} from "@/types/component.ts";
import { fieldStorageConstructor, isFieldDescriptor } from "@/schema/field.ts";
import type { FieldSchema, SchemaOrNull } from "@/types/partitions.ts";
import { SpecError } from "@/errors.ts";
import { isPositiveUint32, isValidName } from "@/utils.ts";

type ComponentSpecRuntime<TStorage extends SchemaOrNull> = {
  name: string;
  schema?: FieldSchema<TStorage> | null;
  maxOwners?: number | null;
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
  ...(FLOAT16_ARRAY ? [FLOAT16_ARRAY] : []),
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

/** What one walk over a declared schema finds; see {@link analyzeSchema}. */
type SchemaAnalysis = {
  /**
   * `true` when the schema is a non-empty object whose entries are well-named typed-array constructors or
   * `field.*` descriptors. A well-formed schema can still be invalid through {@link unsupportedKey}.
   */
  readonly wellFormed: boolean;
  /** The first column whose typed-array constructor Miski does not support (e.g. BigInt64Array), if any. */
  readonly unsupportedKey: string | undefined;
  /**
   * The schema handed to the partitioned buffer: the declared schema when it has no `field.*` entries; otherwise the
   * numeric columns plus the typed column backing each lowered field (bool / enum / entity), in declaration order,
   * or `null` when no typed column remains. String and object fields are stored outside the buffer.
   */
  readonly physical: unknown;
};

const MALFORMED_SCHEMA: SchemaAnalysis = { wellFormed: false, unsupportedKey: undefined, physical: null };

/**
 * Validate a declared schema and build its physical schema in one walk over its entries.
 * Numeric column names follow PartitionedBuffer's naming rule, `field.*` names Miski's stricter one.
 * @param schema - The declared schema (any value)
 */
function analyzeSchema(schema: unknown): SchemaAnalysis {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return MALFORMED_SCHEMA;
  const declared = schema as Record<string, unknown>;
  const keys = Object.keys(declared);
  if (keys.length === 0) return MALFORMED_SCHEMA;
  const physical: Record<string, unknown> = {};
  let physicalCount = 0;
  let hasFields = false;
  let unsupportedKey: string | undefined;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const property = declared[key];
    if (isFieldDescriptor(property)) {
      if (!isValidName(key)) return MALFORMED_SCHEMA;
      hasFields = true;
      const Ctor = fieldStorageConstructor(property);
      if (Ctor === null) continue;
      physical[key] = Ctor;
    } else {
      // A typed-array constructor owns `BYTES_PER_ELEMENT`; Miski supports only the number-valued ones.
      if (
        !isValidPartitionName(key) || typeof property !== "function" || !Object.hasOwn(property, "BYTES_PER_ELEMENT")
      ) {
        return MALFORMED_SCHEMA;
      }
      if (!isSupportedColumnConstructor(property)) unsupportedKey ??= key;
      physical[key] = property;
    }
    physicalCount++;
  }
  return {
    wellFormed: true,
    unsupportedKey,
    physical: !hasFields ? schema : physicalCount === 0 ? null : physical,
  };
}

/** `true` if `spec` is an object with a valid name and owner cap; its schema is checked separately. */
function hasValidSpecHeader(spec: unknown): boolean {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as ComponentSpecRuntime<SchemaOrNull>;
  return isValidName(s.name) && (s.maxOwners == null || isPositiveUint32(s.maxOwners));
}

/**
 * `true` if an analyzed, truthy `spec.schema` is valid for a component.
 * @param schema - The declared schema
 * @param analysis - {@link analyzeSchema} of `schema`
 */
function isValidAnalyzedSchema(schema: object, analysis: SchemaAnalysis): boolean {
  if (!analysis.wellFormed || analysis.unsupportedKey !== undefined) return false;
  // Proxy cursor names cannot also be numeric storage columns.
  return !Object.hasOwn(schema, "entity") && !Object.hasOwn(schema, "slot");
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
  if (!hasValidSpecHeader(spec)) return false;
  const schema = (spec as ComponentSpecRuntime<SchemaOrNull>).schema;
  return !schema || isValidAnalyzedSchema(schema, analyzeSchema(schema));
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
   * @throws {SpecError} - If the spec is otherwise invalid
   */
  constructor(spec: ComponentSpec<TValue, TStorage>) {
    const declared = (spec ?? {}) as { name?: unknown; schema?: unknown };
    const declaredSchema = declared.schema;
    const analysis = declaredSchema ? analyzeSchema(declaredSchema) : undefined;
    if (
      !hasValidSpecHeader(spec) ||
      (analysis !== undefined && !isValidAnalyzedSchema(declaredSchema as object, analysis))
    ) {
      assertNoTupleColumns(`component "${String(declared.name)}"`, declaredSchema);
      if (analysis?.wellFormed && analysis.unsupportedKey !== undefined) {
        throw new SpecError(
          `Invalid component specification: column "${analysis.unsupportedKey}" must use a number-valued typed array ` +
            "(Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, " +
            "Float16Array, Float32Array, Float64Array).",
        );
      }
      throw new SpecError("Invalid component specification.");
    }
    const runtimeSpec = spec as ComponentSpecRuntime<TStorage>;

    this.#id = ComponentRuntime.#nextId++;
    const schema = runtimeSpec.schema ?? null;
    this.#partition = new Partition<TStorage>({
      name: runtimeSpec.name,
      schema: analysis === undefined ? schema : analysis.physical,
      maxOwners: runtimeSpec.maxOwners ?? null,
    } as unknown as PartitionSpec<TStorage>);

    this.#schema = schema;
    this.#isTag = !schema;
  }

  /** The maximum number of entities able to equip this component per world */
  get maxOwners(): number | null {
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
  readonly maxOwners: number | null;
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
