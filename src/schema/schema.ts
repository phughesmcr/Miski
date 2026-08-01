import { Component } from "@/component/component.ts";
import type { ComponentSpec, DynamicComponent } from "@/types/component.ts";
import type { ComponentValue, TypedArrayConstructor } from "@/types/partitions.ts";

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

/** Component property maps keyed by component name. */
export type SchemaComponentMap = Record<string, Record<string, TypedArrayConstructor>>;

/** Canonical name and storage tag for one component property. */
export type CompiledComponentProperty = {
  readonly name: string;
  readonly tag: string;
};

/** Canonical component name and its sorted property metadata. */
export type CompiledComponentEntry = {
  readonly name: string;
  readonly properties: readonly CompiledComponentProperty[];
};

/** Strongly typed component definitions derived from a named schema map. */
export type ComponentsFromSchemaMap<M extends SchemaComponentMap> = {
  [K in keyof M]: Component<ComponentValue<M[K]>, M[K]>;
};

/** Immutable component schema, definitions, metadata, and stable hash. */
export type CompiledComponentSchema<M extends SchemaComponentMap> = {
  readonly componentMap: M;
  readonly components: ComponentsFromSchemaMap<M>;
  readonly entries: readonly CompiledComponentEntry[];
  readonly schemaHash: string;
};

/** Create one strongly typed component definition from its storage schema. */
export function createComponentFromSchema<TSchema extends Readonly<Record<string, TypedArrayConstructor>>>(
  name: string,
  schema: TSchema,
): Component<ComponentValue<TSchema>, TSchema> {
  const spec = { name, schema } as ComponentSpec<ComponentValue<TSchema>, TSchema>;
  return new Component(spec);
}

/** Canonical schema, metadata, and component identities compiled as one immutable truth object. */
export function compileComponentSchema<M extends SchemaComponentMap>(input: M): CompiledComponentSchema<M> {
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
  const frozenEntries = Object.freeze(entries);
  return Object.freeze({
    componentMap: Object.freeze(componentMap) as M,
    components: Object.freeze(components) as ComponentsFromSchemaMap<M>,
    entries: frozenEntries,
    schemaHash: hashEntries(frozenEntries),
  });
}

/** Combine canonical schemas without reconstructing either schema's component identities. */
export function mergeComponentSchemas<A extends SchemaComponentMap, B extends SchemaComponentMap>(
  left: CompiledComponentSchema<A>,
  right: CompiledComponentSchema<B>,
): CompiledComponentSchema<A & B> {
  const names = [...left.entries.map((entry) => entry.name), ...right.entries.map((entry) => entry.name)];
  if (new Set(names).size !== names.length) throw new Error("Cannot merge component schemas with duplicate names.");
  const entries = Object.freeze([...left.entries, ...right.entries].toSorted((a, b) => a.name.localeCompare(b.name)));
  const componentMap: Record<string, Readonly<Record<string, TypedArrayConstructor>>> = {};
  const components: Record<string, DynamicComponent> = {};
  for (const entry of entries) {
    componentMap[entry.name] = (left.componentMap[entry.name] ?? right.componentMap[entry.name])!;
    components[entry.name] = (left.components[entry.name] ?? right.components[entry.name])!;
  }
  return Object.freeze({
    componentMap: Object.freeze(componentMap) as A & B,
    components: Object.freeze(components) as ComponentsFromSchemaMap<A & B>,
    entries,
    schemaHash: hashEntries(entries),
  });
}

/** Compute the stable hash for a component schema map. */
export function componentSchemaHash(components: SchemaComponentMap): string {
  return compileComponentSchema(components).schemaHash;
}

function hashEntries(entries: readonly CompiledComponentEntry[]): string {
  return fnv1a64(JSON.stringify(entries.map((entry) => [
    entry.name,
    entry.properties.map((property) => [property.name, property.tag]),
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
