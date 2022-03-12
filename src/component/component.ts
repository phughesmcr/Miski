/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { isUint32, isValidName } from "../utils/utils.js";
import { ComponentInstance } from "./instance.js";
import { calculateSchemaSize, isValidSchema, Schema } from "./schema.js";

/** { [component name]: component instance } */
export type ComponentRecord = Record<string, ComponentInstance<unknown>>;

export interface ComponentSpec<T> {
  /**
   * The maximum number of entities able to equip this component per world.
   *
   * Defaults to all entities.
   *
   * __Warning__: use this only where memory consumption is a concern, performance will be worse.
   */
  maxEntities?: number;
  /** The component's label */
  name: string;
  /** The component's property definitions. Omit to define a tag component. */
  schema?: Schema<T>;
}

export interface Component<T> {
  /** The maximum number of entities able to equip this component per world. */
  maxEntities: number | null;
  /** `true` if the component has no schema */
  isTag: boolean;
  /** The component's label */
  name: string;
  /** The component's property definitions or `null` if component is a tag */
  schema: Readonly<Schema<T>> | null;
  /** The storage requirements of the schema in bytes for a single entity */
  size: number;
}

/**
 * Define a new component.
 * @param spec the component's specification.
 * @param spec.name the component's string identifier.
 * @param spec.schema the component's optional schema object.
 * @returns A valid Component object - a reusable definitions for the creation of ComponentInstances
 */
export function createComponent<T extends Schema<T>>(spec: ComponentSpec<T>): Component<T> {
  if (!spec) throw new SyntaxError("Component creation requires a specification object.");
  const { maxEntities, name, schema } = spec;
  if (maxEntities && (!isUint32(maxEntities) || maxEntities === 0)) {
    throw new SyntaxError("Component maxEntities must be a Uint32.");
  }
  if (!isValidName(name)) throw new SyntaxError("Component name is invalid.");
  if (schema && !isValidSchema(schema)) throw new SyntaxError("Component schema is invalid.");
  return Object.freeze({
    maxEntities: maxEntities ?? null,
    isTag: Boolean(schema),
    name,
    schema: schema ? Object.freeze({ ...schema }) : null,
    size: schema ? calculateSchemaSize(schema) : 0,
  });
}
