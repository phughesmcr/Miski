/**
 * @module      Component
 * @description A component is a collection of properties that are stored in a world.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 *
 * @example
 * ```ts
 * type Vec2 = { x: number; y: number };
 * const component = Component<Vec2>({
 *   name: "position",
 *   schema: { x: Float32Array, y: Float32Array },
 *   maxEntities: null,
 * });
 * // component can then be registered with a world
 * const world = new World({ components: [component], ... });
 * ```
 */

import { isSchema, isValidName, Partition, type Schema } from "@phughesmcr/partitionedbuffer";
import { isPositiveUint32 } from "../utils.ts";

// deno-lint-ignore no-explicit-any
export type SchemaOrNull = Schema<any> | null;

/** The Component's constructor specification */
export type ComponentSpec<T extends SchemaOrNull> =
  & {
    /** The component's label */
    name: string;

    /**
     * The maximum number of entities able to equip this component per world.
     *
     * __Warning__: use this only where memory use is a concern, performance will be worse.
     */
    maxEntities?: number | null;
  }
  // deno-lint-ignore no-explicit-any
  & (T extends Schema<any> ? {
      /** The component's property definitions */
      schema: Schema<T>;
    }
    : {
      /** No schema for tag components */
      schema?: null;
    });

/**
 * Component specification type guard.
 * @param spec the component's specification.
 * @returns `true` if the spec is valid, `false` otherwise
 */
export function isComponentSpec<T extends SchemaOrNull>(spec: unknown): spec is ComponentSpec<T> {
  const { maxEntities, name, schema } = spec as ComponentSpec<T>;
  if (!isValidName(name)) return false;
  if (maxEntities && !isPositiveUint32(maxEntities)) return false;
  if (schema && !isSchema(schema)) return false;
  return true;
}

/** Component type guard */
export function isComponent(component: unknown): component is Component<SchemaOrNull> {
  return component instanceof Component;
}

/** Checks if a value is an array of Components */
export function isValidComponentArray(array: unknown): array is Array<Component<SchemaOrNull>> {
  return Array.isArray(array) && array.every(isComponent);
}

/** */
export class Component<T extends SchemaOrNull> {
  /** The component's storage partition */
  #partition: Partition<T>;

  /** `true` if the component has no schema */
  readonly isTag: boolean;

  /**
   * Create a new component.
   * @param spec the component's specification.
   * @throws {TypeError} If the spec is invalid
   */
  constructor(spec: ComponentSpec<T>) {
    if (!isComponentSpec(spec)) {
      throw new TypeError("Invalid component specification.");
    }
    const { name, schema, maxEntities = null } = spec;
    this.#partition = new Partition<T>({
      name,
      schema: schema as Schema<T> | null,
      maxOwners: maxEntities as number | null,
    });
    this.isTag = !schema;
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
  get schema(): Schema<T> | null {
    return this.#partition.schema as Schema<T> | null;
  }

  /** The component's size in bytes for a single entity */
  get size(): number {
    return this.#partition.size;
  }
}
