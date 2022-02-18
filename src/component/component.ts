/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { isValidName } from "../utils.js";
import { World } from "../world.js";
import { ComponentInstance } from "./instance.js";
import { calculateSchemaSize, isValidSchema, Schema } from "./schema.js";

/** { [component name]: component instance } */
export type ComponentRecord = Record<string, ComponentInstance<unknown>>;

export interface ComponentSpec<T> {
  /** The component's label */
  name: string;
  /** The component's property definitions. Omit to define a tag component. */
  schema?: Schema<T>;
}

export interface Component<T> {
  instance: (world: World) => ComponentInstance<T> | undefined;
  /** `true` if the component has no schema */
  isTag: boolean;
  /** The component's label */
  name: string;
  /** The component's property definitions or `null` if component is a tag */
  schema: Readonly<Schema<T>> | null;
  /** The storage requirements of the schema in bytes for a single entity */
  size: number;
}

function getInstancer<T>(state: Component<T>) {
  return function (world: World) {
    return world.components.get(state) as ComponentInstance<T> | undefined;
  };
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
  const { name, schema } = spec;
  if (!isValidName(name)) throw new SyntaxError("Component name is invalid.");
  if (schema && !isValidSchema(schema)) throw new SyntaxError("Component schema is invalid.");
  const component = {
    isTag: schema ? false : true,
    name,
    schema: schema ? Object.freeze({ ...schema }) : null,
    size: schema ? calculateSchemaSize(schema) : 0,
  } as Component<T>;
  component.instance = getInstancer(component);
  return Object.freeze(component);
}
