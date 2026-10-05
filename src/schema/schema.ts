import { Component, isValidComponentSpec } from "@/component/component.ts";
import type { ComponentSpec, DynamicComponent } from "@/types/component.ts";
import type { ComponentValue, SchemaProperty, TypedArrayConstructor } from "@/types/partitions.ts";
import { isPositiveUint32 } from "@/utils.ts";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

const CONSTRUCTOR_TAGS = new Map<TypedArrayConstructor, string>([
  [Int8Array, "i8"],
  [Int16Array, "i16"],
  [Int32Array, "i32"],
  [Uint8Array, "u8"],
  [Uint16Array, "u16"],
  [Uint32Array, "u32"],
  [Float32Array, "f32"],
  [Float64Array, "f64"],
]);

/**
 * Name a reusable component storage shape from a schema object.
 *
 * Prefer defining the schema once (via {@link defineComponentSchema}), then aliasing:
 * ```ts
 * const vec2 = defineComponentSchema({ x: Float32Array, y: Float32Array });
 * type Vec2 = ComponentSchema<typeof vec2>;
 * ```
 *
 * Avoids hand-writing `Float32ArrayConstructor` while keeping explicit typed-array
 * control in the schema value. Readonly from `const` inference is stripped so
 * storage shapes stay writable through proxies and public APIs.
 */
export type ComponentSchema<S extends Record<string, SchemaProperty>> = {
  -readonly [K in keyof S]: S[K];
};

/**
 * Capture a component schema object with precise constructor types.
 *
 * Use with {@link ComponentSchema} when you want a named storage alias, or pass
 * the result straight into `new Component({ schema })`.
 */
export function defineComponentSchema<const S extends Record<string, SchemaProperty>>(
  schema: S,
): ComponentSchema<S> {
  return schema;
}

/** Component property maps keyed by component name. */
export type SchemaComponentMap = Record<string, Record<string, TypedArrayConstructor>>;

/**
 * Tag declaration for {@link createEcsWorld} / schema compile.
 *
 * - `true` - uncapped tag
 * - `{ maxEntities }` - ownership cap (same rules as ComponentSpec)
 */
export type TagSpec = true | { readonly maxEntities: number };

/** Named tag map for typed ECS bootstrap. */
export type TagMap = Record<string, TagSpec>;

/** Canonical name and storage tag for one component property. */
export type CompiledComponentProperty = {
  readonly name: string;
  readonly tag: string;
};

/** Canonical component/tag name and its sorted property metadata. */
export type CompiledComponentEntry = {
  readonly name: string;
  readonly properties: readonly CompiledComponentProperty[];
  /** Present for tag components with an ownership cap. */
  readonly maxEntities?: number;
  /** `true` when this entry is a tag (no data schema). */
  readonly isTag?: true;
};

/** Strongly typed component definitions derived from a named schema map. */
export type ComponentsFromSchemaMap<M extends SchemaComponentMap> = {
  [K in keyof M]: Component<ComponentValue<M[K]>, M[K]>;
};

/** Strongly typed tag component definitions derived from a tag map. */
export type TagsFromMap<T extends TagMap> = {
  [K in keyof T]: Component<null, null>;
};

/** Unified registry of data + tag component definitions. */
export type RegistryFromMaps<M extends SchemaComponentMap, T extends TagMap> =
  & ComponentsFromSchemaMap<M>
  & TagsFromMap<T>;

/** Immutable component schema, definitions, metadata, and stable hash. */
export type CompiledComponentSchema<
  M extends SchemaComponentMap = SchemaComponentMap,
  T extends TagMap = Record<never, never>,
> = {
  readonly componentMap: M;
  readonly tagMap: T;
  readonly components: RegistryFromMaps<M, T>;
  readonly entries: readonly CompiledComponentEntry[];
  readonly schemaHash: string;
};

/** Create one strongly typed component definition from its storage schema. */
export function createComponentFromSchema<TSchema extends Readonly<Record<string, TypedArrayConstructor>>>(
  name: string,
  schema: TSchema,
): Component<ComponentValue<TSchema>, TSchema> {
  const spec = { name, schema } as ComponentSpec<ComponentValue<TSchema>, TSchema>;
  return new Component<ComponentValue<TSchema>, TSchema>(spec);
}

/** Create a tag component definition from a {@link TagSpec}. */
export function createTagFromSpec(name: string, spec: TagSpec): Component<null, null> {
  if (spec === true) {
    return new Component({ name });
  }
  if (!isPositiveUint32(spec.maxEntities) || !Number.isInteger(spec.maxEntities)) {
    throw new TypeError(`Tag "${name}" maxEntities must be a positive integer.`);
  }
  return new Component({ name, maxEntities: spec.maxEntities });
}

type NormalizedSchema = {
  componentMap: Record<string, Readonly<Record<string, TypedArrayConstructor>>>;
  tagMap: Record<string, TagSpec>;
  entries: readonly CompiledComponentEntry[];
};

function compareEntryNames(a: CompiledComponentEntry, b: CompiledComponentEntry): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Validate and capture schema metadata without allocating component identities. */
function normalizeSchema(input: SchemaComponentMap, tags?: TagMap): NormalizedSchema {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Component schema must be an object.");
  }
  if (tags !== undefined && (typeof tags !== "object" || tags === null || Array.isArray(tags))) {
    throw new TypeError("Tag schema must be an object.");
  }
  const componentMap: NormalizedSchema["componentMap"] = Object.create(null);
  const tagMap: NormalizedSchema["tagMap"] = Object.create(null);
  const entries: CompiledComponentEntry[] = [];
  for (const componentName of Object.keys(input).toSorted()) {
    if (tags !== undefined && Object.hasOwn(tags, componentName)) {
      throw new Error(`Tag "${componentName}" collides with a component name.`);
    }
    const inputProperties = input[componentName];
    if (typeof inputProperties !== "object" || inputProperties === null || Array.isArray(inputProperties)) {
      throw new TypeError(`Component ${componentName} must be an object.`);
    }
    const properties: Record<string, TypedArrayConstructor> = Object.create(null);
    const compiledProperties: CompiledComponentProperty[] = [];
    for (const propertyName of Object.keys(inputProperties).toSorted()) {
      const constructor = inputProperties[propertyName]!;
      const tag = CONSTRUCTOR_TAGS.get(constructor);
      if (tag === undefined) {
        throw new TypeError(`Unsupported typed-array constructor for ${componentName}.${propertyName}.`);
      }
      properties[propertyName] = constructor;
      compiledProperties.push(Object.freeze({ name: propertyName, tag }));
    }
    const frozenProperties = Object.freeze(properties);
    if (!isValidComponentSpec({ name: componentName, schema: frozenProperties })) {
      throw new TypeError("Invalid component specification.");
    }
    componentMap[componentName] = frozenProperties;
    entries.push(Object.freeze({ name: componentName, properties: Object.freeze(compiledProperties) }));
  }
  for (const tagName of Object.keys(tags ?? {}).toSorted()) {
    const spec = tags![tagName]!;
    if (spec !== true && (typeof spec !== "object" || spec === null || !Object.hasOwn(spec, "maxEntities"))) {
      throw new TypeError(`Tag "${tagName}" must be true or { maxEntities }.`);
    }
    if (spec !== true && (!isPositiveUint32(spec.maxEntities) || !Number.isInteger(spec.maxEntities))) {
      throw new TypeError(`Tag "${tagName}" maxEntities must be a positive integer.`);
    }
    if (!isValidComponentSpec({ name: tagName })) {
      throw new TypeError("Invalid component specification.");
    }
    tagMap[tagName] = spec === true ? true : Object.freeze({ maxEntities: spec.maxEntities });
    const entry: CompiledComponentEntry = spec === true ?
      { name: tagName, properties: Object.freeze([]), isTag: true } :
      { name: tagName, properties: Object.freeze([]), isTag: true, maxEntities: spec.maxEntities };
    entries.push(Object.freeze(entry));
  }
  return {
    componentMap: Object.freeze(componentMap),
    tagMap: Object.freeze(tagMap),
    entries: Object.freeze(entries.toSorted(compareEntryNames)),
  };
}

function constructComponents(schema: NormalizedSchema): Record<string, DynamicComponent> {
  const components: Record<string, DynamicComponent> = Object.create(null);
  for (const entry of schema.entries) {
    components[entry.name] = entry.isTag === true ?
      createTagFromSpec(entry.name, schema.tagMap[entry.name]!) :
      createComponentFromSchema(entry.name, schema.componentMap[entry.name]!);
  }
  return Object.freeze(components);
}

/** @internal Build validated component definitions without calculating a schema hash. */
export function createComponentRegistry<M extends SchemaComponentMap, T extends TagMap>(
  input: M,
  tags?: T,
): RegistryFromMaps<M, T> {
  return constructComponents(normalizeSchema(input, tags)) as RegistryFromMaps<M, T>;
}

/**
 * Canonical schema, metadata, and component identities compiled as one immutable truth object.
 *
 * @param input - Data component schemas keyed by name
 * @param tags - Optional tag map (`true` or `{ maxEntities }`)
 */
export function compileComponentSchema<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
>(input: M, tags?: T): CompiledComponentSchema<M, T> {
  const schema = normalizeSchema(input, tags);
  return Object.freeze({
    componentMap: schema.componentMap as M,
    tagMap: schema.tagMap as T,
    components: constructComponents(schema) as RegistryFromMaps<M, T>,
    entries: schema.entries,
    schemaHash: hashEntries(schema.entries),
  });
}

/** Combine canonical schemas without reconstructing either schema's component identities. */
export function mergeComponentSchemas<
  A extends SchemaComponentMap,
  TA extends TagMap,
  B extends SchemaComponentMap,
  TB extends TagMap,
>(
  left: CompiledComponentSchema<A, TA>,
  right: CompiledComponentSchema<B, TB>,
): CompiledComponentSchema<A & B, TA & TB> {
  const names = [...left.entries.map((entry) => entry.name), ...right.entries.map((entry) => entry.name)];
  if (new Set(names).size !== names.length) {
    throw new Error("Cannot merge component schemas with duplicate names.");
  }
  const entries = Object.freeze(
    [...left.entries, ...right.entries].toSorted(compareEntryNames),
  );
  const componentMap = Object.assign(Object.create(null), left.componentMap, right.componentMap);
  const tagMap = Object.assign(Object.create(null), left.tagMap, right.tagMap);
  const components = Object.assign(Object.create(null), left.components, right.components);
  return Object.freeze({
    componentMap: Object.freeze(componentMap) as A & B,
    tagMap: Object.freeze(tagMap) as TA & TB,
    components: Object.freeze(components) as RegistryFromMaps<A & B, TA & TB>,
    entries,
    schemaHash: hashEntries(entries),
  });
}

/** Compute the stable hash for a component schema map (and optional tags). */
export function componentSchemaHash(
  components: SchemaComponentMap,
  tags?: TagMap,
): string {
  return hashEntries(normalizeSchema(components, tags).entries);
}

function hashEntries(entries: readonly CompiledComponentEntry[]): string {
  return fnv1a64(JSON.stringify(entries.map((entry) => [
    entry.name,
    entry.properties.map((property) => [property.name, property.tag]),
    entry.isTag === true ? "tag" : "data",
    entry.maxEntities ?? null,
  ])));
}

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}
