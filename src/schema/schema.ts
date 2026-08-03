import { Component } from "@/component/component.ts";
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
 * - `true` — uncapped tag
 * - `{ maxEntities }` — ownership cap (same rules as ComponentSpec)
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
  if (!isPositiveUint32(spec.maxEntities) || spec.maxEntities === 0) {
    throw new TypeError(`Tag "${name}" maxEntities must be a positive integer.`);
  }
  return new Component({ name, maxEntities: spec.maxEntities });
}

function assertNoNameCollisions(
  componentNames: readonly string[],
  tagNames: readonly string[],
): void {
  const seen = new Set<string>();
  for (const name of componentNames) {
    if (seen.has(name)) {
      throw new Error(`Duplicate component name "${name}".`);
    }
    seen.add(name);
  }
  for (const name of tagNames) {
    if (seen.has(name)) {
      throw new Error(`Tag "${name}" collides with a component name.`);
    }
    seen.add(name);
  }
}

function compileDataEntries<M extends SchemaComponentMap>(
  input: M,
): {
  componentMap: Record<string, Readonly<Record<string, TypedArrayConstructor>>>;
  entries: CompiledComponentEntry[];
  components: Record<string, DynamicComponent>;
} {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Component schema must be an object.");
  }
  const componentMap: Record<string, Readonly<Record<string, TypedArrayConstructor>>> = {};
  const entries: CompiledComponentEntry[] = [];
  const components: Record<string, DynamicComponent> = {};
  for (const componentName of Object.keys(input).toSorted()) {
    const inputProperties = input[componentName];
    if (typeof inputProperties !== "object" || inputProperties === null) {
      throw new TypeError(`Component ${componentName} must be an object.`);
    }
    const properties: Record<string, TypedArrayConstructor> = {};
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
    componentMap[componentName] = frozenProperties;
    entries.push(Object.freeze({ name: componentName, properties: Object.freeze(compiledProperties) }));
    components[componentName] = createComponentFromSchema(
      componentName,
      frozenProperties,
    );
  }
  return { componentMap, entries, components };
}

function compileTagEntries<T extends TagMap>(
  tags: T,
): {
  tagMap: Record<string, TagSpec>;
  entries: CompiledComponentEntry[];
  components: Record<string, DynamicComponent>;
} {
  if (typeof tags !== "object" || tags === null) {
    throw new TypeError("Tag schema must be an object.");
  }
  const tagMap: Record<string, TagSpec> = {};
  const entries: CompiledComponentEntry[] = [];
  const components: Record<string, DynamicComponent> = {};
  for (const tagName of Object.keys(tags).toSorted()) {
    const spec = tags[tagName]!;
    if (spec !== true && (typeof spec !== "object" || spec === null || !("maxEntities" in spec))) {
      throw new TypeError(`Tag "${tagName}" must be true or { maxEntities }.`);
    }
    const component = createTagFromSpec(tagName, spec);
    tagMap[tagName] = spec === true ? true : Object.freeze({ maxEntities: spec.maxEntities });
    const entry: CompiledComponentEntry = spec === true ?
      { name: tagName, properties: Object.freeze([]), isTag: true } :
      { name: tagName, properties: Object.freeze([]), isTag: true, maxEntities: spec.maxEntities };
    entries.push(Object.freeze(entry));
    components[tagName] = component;
  }
  return { tagMap, entries, components };
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
  const data = compileDataEntries(input);
  const tagNames = tags === undefined ? [] : Object.keys(tags);
  assertNoNameCollisions(Object.keys(input), tagNames);

  const tagResult = tags === undefined ?
    {
      tagMap: {} as Record<string, TagSpec>,
      entries: [] as CompiledComponentEntry[],
      components: {} as Record<string, DynamicComponent>,
    } :
    compileTagEntries(tags);

  const entries = Object.freeze(
    [...data.entries, ...tagResult.entries].toSorted((a, b) => a.name.localeCompare(b.name)),
  );
  const components = Object.freeze({
    ...data.components,
    ...tagResult.components,
  }) as RegistryFromMaps<M, T>;

  return Object.freeze({
    componentMap: Object.freeze(data.componentMap) as M,
    tagMap: Object.freeze(tagResult.tagMap) as T,
    components,
    entries,
    schemaHash: hashEntries(entries),
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
    [...left.entries, ...right.entries].toSorted((a, b) => a.name.localeCompare(b.name)),
  );
  const componentMap: Record<string, Readonly<Record<string, TypedArrayConstructor>>> = {
    ...left.componentMap,
    ...right.componentMap,
  };
  const tagMap: Record<string, TagSpec> = {
    ...left.tagMap,
    ...right.tagMap,
  };
  const components: Record<string, DynamicComponent> = {
    ...left.components,
    ...right.components,
  };
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
  return compileComponentSchema(components, tags).schemaHash;
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
  function write(byte: number): void {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  for (let index = 0; index < value.length; index++) {
    const first = value.charCodeAt(index);
    if (first < 0x80) {
      write(first);
    } else if (first < 0x800) {
      write(0xc0 | (first >> 6));
      write(0x80 | (first & 0x3f));
    } else if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        index++;
        const point = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        write(0xf0 | (point >> 18));
        write(0x80 | ((point >> 12) & 0x3f));
        write(0x80 | ((point >> 6) & 0x3f));
        write(0x80 | (point & 0x3f));
      } else {
        write(0xef);
        write(0xbf);
        write(0xbd);
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      write(0xef);
      write(0xbf);
      write(0xbd);
    } else {
      write(0xe0 | (first >> 12));
      write(0x80 | ((first >> 6) & 0x3f));
      write(0x80 | (first & 0x3f));
    }
  }
  return hash.toString(16).padStart(16, "0");
}
