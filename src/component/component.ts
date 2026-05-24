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
 *
 * // component can then be registered with a world
 * const world = new World({ components: [component], ... });
 * ```
 */

import { isSchema, isValidName, Partition, type PartitionSpec } from "@phughesmcr/partitionedbuffer";
import { $_COMPONENT_ID_KEY, $_PARTITION_KEY } from "@/constants.ts";
import type { ComponentPrivateMethods, ComponentSpec, DynamicComponent, Schema, SchemaOrNull } from "@/types.ts";
import { isPositiveUint32 } from "@/utils.ts";

/**
 * Component specification type guard.
 * @param spec - The component's specification.
 * @returns `true` if the spec is valid, `false` otherwise
 */
export function isValidComponentSpec<T extends SchemaOrNull>(spec: unknown): spec is ComponentSpec<T> {
  if (!spec || typeof spec !== "object") return false;
  const s = spec as ComponentSpec<T>;
  if (!isValidName(s.name)) return false;
  if (s.maxEntities != null && (!isPositiveUint32(s.maxEntities) || s.maxEntities === 0)) return false;
  if (s.schema && !isSchema(s.schema)) return false;
  return true;
}

/** Component type guard */
export function isComponent(component: unknown): component is DynamicComponent {
  return !!(component && component instanceof Component);
}

/** Checks if a value is an array of Components */
export function isValidComponentArray(array: unknown): array is Array<DynamicComponent> {
  if (!Array.isArray(array)) return false;
  for (let i = 0; i < array.length; i++) {
    if (!isComponent(array[i])) return false;
  }
  return true;
}

/** A Component is a collection of properties that are stored in a world */
export class Component<T extends SchemaOrNull = null> implements ComponentPrivateMethods<T> {
  /** Next stable id for component definitions */
  static #nextId = 0;

  /** Stable id for this component definition */
  readonly #id: number;

  /** The component's storage partition */
  readonly #partition: Partition<T>;

  /** `true` if the component has no schema */
  readonly #isTag: boolean;

  /**
   * Create a new component.
   * @param spec - The component's specification.
   * @throws {TypeError} - If the spec is invalid
   */
  constructor(spec: ComponentSpec<T>) {
    if (!isValidComponentSpec(spec)) {
      throw new TypeError("Invalid component specification.");
    }

    this.#id = Component.#nextId++;
    this.#partition = new Partition<T>({
      name: spec.name,
      schema: spec.schema as Schema<T> | null,
      maxOwners: spec.maxEntities ?? null,
    } as unknown as PartitionSpec<T>);

    this.#isTag = !spec.schema;
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
  get [$_PARTITION_KEY](): Partition<T> {
    return this.#partition;
  }
}
