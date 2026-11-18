import { Component } from "@/component/component.ts";
import { ComponentDataError } from "@/errors.ts";
import { isRelation } from "@/relation/relation.ts";
import { type FieldDescriptor, isFieldDescriptor } from "@/schema/field.ts";
import type { ComponentBundle, ComponentBundleEntryInput } from "@/types/component-bundle.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentData, SchemaOrNull, SchemaProperty, TypedArray } from "@/types/partitions.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";

/** Flattened defaults of every prefab, parallel to its components (kept off the public surface). */
const defaultsByPrefab = new WeakMap<object, readonly PrefabDefaults[]>();

/** The specification for a {@link Prefab}. */
export type PrefabSpec<TBundle extends readonly ComponentBundleEntryInput[] = readonly ComponentBundleEntryInput[]> = {
  /** Label used in tooling and error messages (default `"prefab"`). */
  readonly name?: string;
  /** Parent template. Its components come first; this spec's fields override the parent's field by field. */
  readonly extends?: Prefab;
  /** `[component]` for tags, `[component, data]` for data components; omitted fields default to zero. */
  readonly components: TBundle & ComponentBundle<TBundle>;
};

/**
 * Frozen canonical defaults for one prefab component, keyed by field name; `null` for tags. Values are logical (a
 * boolean, an enum label, `null` for entity fields). An object field without a prefab value has no key: each instance
 * gets the field's `create()` result, or `null`.
 */
export type PrefabDefaults = Readonly<Record<string, unknown>> | null;

/** Mutable defaults while a definition is being flattened. */
type DraftRow = Record<string, unknown> | null;

function columnConstructor(property: SchemaProperty): new (length: number) => TypedArray {
  return (Array.isArray(property) ? property[0] : property) as unknown as new (length: number) => TypedArray;
}

/**
 * Validate one non-numeric field value for a prefab definition.
 * @returns the value to store in the frozen defaults
 */
function definitionFieldValue(name: string, key: string, property: FieldDescriptor, value: unknown): unknown {
  switch (property.kind) {
    case "bool":
      if (typeof value !== "boolean") {
        throw new ComponentDataError(`Component ${name} data field "${key}" must be a boolean.`);
      }
      return value;
    case "enum":
      if (typeof value !== "string" || !property.labels.includes(value)) {
        throw new ComponentDataError(
          `Component ${name} data field "${key}" must be one of its enum labels (${property.labels.join(", ")}).`,
        );
      }
      return value;
    case "entity":
      // Handles belong to one world, and a prefab outlives every world: targets are instantiate overrides.
      if (value !== null) {
        throw new ComponentDataError(
          `Component ${name} data field "${key}" must be null in a prefab; pass the target as an instantiate override.`,
        );
      }
      return null;
    case "string":
      if (typeof value !== "string") {
        throw new ComponentDataError(`Component ${name} data field "${key}" must be a string.`);
      }
      return value;
    case "object": {
      if (value === undefined) {
        throw new ComponentDataError(`Component ${name} data field "${key}" cannot be undefined.`);
      }
      if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
      // Every instance needs its own copy; without `clone` all instances would share (and mutate) one object.
      const clone = property.clone;
      if (clone === undefined) {
        throw new ComponentDataError(
          `Component ${name} data field "${key}" holds an object, so its field needs a clone hook to be used in a prefab.`,
        );
      }
      // Copy at definition so later mutations of the caller's object never reach instances.
      return clone(value);
    }
  }
}

/** Validate one definition payload and merge its canonical values into `row`. */
function mergeDefinitionData(component: DynamicComponent, row: Record<string, unknown>, data: unknown): void {
  const name = component.name;
  if (!isObject(data)) {
    throw new TypeError(`Component data for "${name}" must be an object.`);
  }
  const schema = component.schema as Record<string, unknown>;
  const values = data as Record<string, unknown>;
  for (const key in values) {
    if (hasOwnProperty(values, key) && !hasOwnProperty(schema, key)) {
      throw new ComponentDataError(`Component ${name} does not define data field "${key}".`);
    }
  }
  for (const key of Object.keys(schema)) {
    if (!hasOwnProperty(values, key)) continue;
    const value = values[key];
    const property = schema[key];
    if (isFieldDescriptor(property)) {
      row[key] = definitionFieldValue(name, key, property, value);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ComponentDataError(`Component ${name} data field "${key}" must be a finite number.`);
    }
    // Canonicalize through the field's own typed array, so instances store exactly these values.
    row[key] = canonicalizeStoredValue(name, key, value, new (columnConstructor(property as SchemaProperty))(1));
  }
}

/** Field defaults a new owner starts at; object fields stay absent (they take `create()` per instance). */
function zeroRow(component: DynamicComponent): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const schema = component.schema as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    const property = schema[key];
    if (!isFieldDescriptor(property)) {
      row[key] = 0;
      continue;
    }
    switch (property.kind) {
      case "bool":
        row[key] = false;
        break;
      case "enum":
        row[key] = property.labels[0];
        break;
      case "entity":
        row[key] = null;
        break;
      case "string":
        row[key] = "";
        break;
    }
  }
  return row;
}

/**
 * An immutable entity template: a set of components with default values.
 *
 * A prefab is a definition, like a {@link Component} or a query: it lives outside every world, uses no entity slot,
 * never appears in queries, and can be instantiated in any world that registers its components. Instantiation copies
 * the defaults into the new entity, so later prefab definitions (including children) never affect instances.
 * Object-field defaults are frozen only at the top level; treat them as read-only, since changing one changes every
 * later instance (and every prefab that extends this one).
 *
 * @example
 * ```ts
 * const goblin = new Prefab({ name: "goblin", components: [[Position, { x: 0, y: 0 }], [Enemy]] });
 * const boss = new Prefab({ name: "boss", extends: goblin, components: [[Health, { hp: 500 }]] });
 * const entity = world.entities.instantiateOrThrow(boss, [[Position, { x: 5 }]]);
 * ```
 */
export class Prefab<
  const TBundle extends readonly ComponentBundleEntryInput[] = readonly ComponentBundleEntryInput[],
> {
  /** The prefab's label. */
  readonly name: string;

  /** The prefab this one extends, if any. */
  readonly parent: Prefab | undefined;

  /** Every component an instance receives, parent components first, in definition order. */
  readonly components: readonly DynamicComponent[];

  /**
   * Create a prefab.
   * @param spec - The prefab specification
   * @throws {TypeError} - If the spec, an entry, or a payload is malformed, or a value overflows its column
   * @throws {RangeError} - If a component appears twice in `spec.components`
   * @throws {ComponentDataError} - If a payload names an unknown field, holds a non-finite value, or targets a tag
   */
  constructor(spec: PrefabSpec<TBundle>) {
    if (!isObject(spec)) throw new TypeError("Prefab spec must be an object.");
    const { name = "prefab", extends: parent, components: entries } = spec as PrefabSpec;
    if (typeof name !== "string") throw new TypeError("Prefab name must be a string.");
    if (parent !== undefined && !(parent instanceof Prefab)) {
      throw new TypeError("Prefab extends must be a Prefab.");
    }
    if (!Array.isArray(entries)) {
      throw new TypeError("Prefab components must be an array of [component] or [component, data] tuples.");
    }

    const components: DynamicComponent[] = parent === undefined ? [] : [...parent.components];
    const rows: DraftRow[] = parent === undefined ? [] : prefabDefaults(parent).map((row) => row && { ...row });
    const own = new Set<DynamicComponent>();
    for (const entry of entries as readonly unknown[]) {
      if (!Array.isArray(entry) || (entry.length !== 1 && entry.length !== 2)) {
        throw new TypeError("Prefab entries must be [component] or [component, data] tuples.");
      }
      const component = entry[0] as DynamicComponent;
      if (!(component instanceof (Component as unknown as abstract new (...args: never[]) => DynamicComponent))) {
        throw new TypeError("Prefab entries must reference a Component.");
      }
      if (isRelation(component)) {
        // Pairs need a target in a specific world; attach them with world.relations after instantiation.
        throw new TypeError(
          `Component "${component.name}" is a relation; add its pairs with world.relations after instantiating.`,
        );
      }
      if (own.has(component)) {
        throw new RangeError(`Duplicate component "${component.name}" in prefab.`);
      }
      own.add(component);
      const isTag = component.schema === null;
      if (isTag && entry.length === 2) {
        throw new ComponentDataError(`Component ${component.name} has no data storage.`);
      }
      let index = components.indexOf(component);
      if (index === -1) {
        index = components.length;
        components.push(component);
        rows.push(isTag ? null : zeroRow(component));
      }
      if (entry.length === 2 && entry[1] !== undefined) mergeDefinitionData(component, rows[index]!, entry[1]);
    }

    this.name = name;
    this.parent = parent;
    this.components = Object.freeze(components);
    defaultsByPrefab.set(this, Object.freeze(rows.map((row) => row && Object.freeze(row))));
    Object.freeze(this);
  }

  /**
   * Check whether instances of this prefab receive a component.
   * @param component - The component to look for
   * @returns `true` if instances of this prefab receive `component`
   */
  has(component: DynamicComponent): boolean {
    return this.components.includes(component);
  }

  /**
   * Read the flattened defaults the prefab gives a component.
   * @param component - The component to read
   * @returns the frozen defaults for `component`, `null` for a tag, or `undefined` if the prefab lacks the component
   */
  get<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage>,
  ): Readonly<ComponentData<TValue>> | null | undefined {
    const index = this.components.indexOf(component as unknown as DynamicComponent);
    if (index === -1) return undefined;
    return prefabDefaults(this)[index] as Readonly<ComponentData<TValue>> | null;
  }

  /** Runtime string tag used by `Object.prototype.toString`. */
  get [Symbol.toStringTag](): string {
    return "Prefab";
  }
}

/** @internal Read a prefab's defaults parallel to its components. */
export function prefabDefaults(prefab: Prefab): readonly PrefabDefaults[] {
  return defaultsByPrefab.get(prefab)!;
}
