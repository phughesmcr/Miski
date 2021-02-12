// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { deepAssign } from "../utils";

export type InternalComponentSpec<T> = ComponentSpec<T> & { id: number };

export interface ComponentSpec<T> {
  entityLimit?: number | null;
  name: string;
  properties: T;
  removable?: boolean,
}

export type Component<T> = Readonly<{
  entityLimit: number | null;
  id: number,
  name: string;
  properties: T;
  removable: boolean,
}>

export function createComponent<T>(spec: InternalComponentSpec<T>): Component<T> {
  const {
    entityLimit = null,
    id,
    name,
    properties,
    removable = true,
  } = { ...spec };

  // check all required data is present
  if (!name || !properties || typeof properties !== 'object' || id == null) {
    throw new Error('malformed component.');
  }

  // clone and seal properties object
  deepAssign(properties, spec.properties);
  Object.seal(properties);

  return Object.freeze(
    Object.create(null, {
      entityLimit: {
        value: entityLimit,
        enumerable: true,
      },
      id: {
        value: id,
        enumerable: true,
      },
      name: {
        value: name,
        enumerable: true,
      },
      properties: {
        value: properties,
        enumerable: true,
      },
      removable: {
        value: removable,
        enumerable: true,
      }
    })
  ) as Component<T>;
}
