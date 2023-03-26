/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { isPositiveInt, isValidName } from "../utils/utils.js";
import { calculateSchemaSize, isValidSchema, Schema } from "./schema.js";

export interface ComponentSpec<T> {
  /**
   * The maximum number of entities able to equip this component per world.
   *
   * __Warning__: use this only where memory consumption is a concern, performance will be worse.
   */
  maxEntities?: number;
  /** The component's label */
  name: string;
  /** The component's property definitions. Omit to define a tag component. */
  schema?: Schema<T>;
}

export class Component<T extends Schema<T>> {
  /** `true` if the component has no schema */
  readonly isTag: boolean;
  /** The maximum number of entities able to equip this component per world. */
  readonly maxEntities: number | null;
  /** The component's label */
  readonly name: string;
  /** The component's property definitions or `null` if component is a tag */
  readonly schema: Readonly<Schema<T>> | null;
  /** The storage requirements of the schema in bytes for a single entity */
  readonly size: number;

  /**
   * Define a new component.
   * @param spec the component's specification.
   * @param spec.name the component's string identifier.
   * @param spec.schema the component's optional schema object.
   * @returns A valid Component object - a reusable definitions for the creation of ComponentInstances
   * @throws If the spec is invalid
   */
  constructor(spec: ComponentSpec<T>) {
    if (!spec) throw new SyntaxError("A specification object is required.");
    const { maxEntities = null, name, schema = null } = spec;
    if (maxEntities && !isPositiveInt(maxEntities)) throw new SyntaxError("spec.maxEntities must be a Uint32 > 0.");
    if (!isValidName(name)) throw new SyntaxError("spec.name is invalid.");
    if (!isValidSchema(schema)) throw new SyntaxError("spec.schema is invalid.");
    this.isTag = !schema;
    this.maxEntities = maxEntities ?? null;
    this.name = name;
    this.schema = schema ? Object.freeze({ ...schema }) : null;
    this.size = schema ? calculateSchemaSize(schema) : 0;
    Object.freeze(this);
  }
}
