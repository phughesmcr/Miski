// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from './entity';

/** Component specification object */
export type ComponentSpec<T = Record<string, unknown>> = Omit<InternalComponentSpec<T>, "id">;

/** Internal component specification object */
interface InternalComponentSpec<T = Record<string, unknown>> {
  id: bigint,
  name: string,
  properties: T,
}

export interface Component<T = Record<string, unknown>> {
  id: Readonly<bigint>,
  name: Readonly<string>,
  entities: Readonly<Entity[]>,
  properties: T,
  /** Check if an entity is associated with this category */
  hasEntity(entity: Entity): boolean
  /** @hidden */
  _addEntity(entity: Entity): void,
  /** @hidden */
  _removeEntity(entity: Entity): void,
}

/**
 * Creates a new component object
 * @param spec the components specification object
 */
export function _createComponent<T = Record<string, unknown>>(spec: InternalComponentSpec<T>): Component<T> {
  const { id, name, properties } = { ...spec };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const { entities } = { entities: new Set() as Set<Entity> };

  const getters = {
    get id(): bigint {
      return id;
    },

    get name(): string {
      return name;
    },

    /** @returns an array of entities associated with this component */
    get entities(): Entity[] {
      return Array.from(entities);
    },

    /** @returns the default properties of this component */
    get properties(): T {
      return properties;
    }
  };

  /**
   * @hidden
   * Associate an entity with this component
   * @param entity the entity to associate
   * @returns this component
   */
  const _addEntity = function(entity: Entity): void {
    entities.add(entity);
  };

  /**
   * @hidden
   * Disassociate an entity from this component
   * @param entity the entity to disassociate
   * @returns this component
   */
  const _removeEntity = function(entity: Entity): void {
    entities.delete(entity);
  };

  const hasEntity = function(entity: Entity): boolean {
    return entities.has(entity);
  };

  return Object.freeze(
    Object.assign(
      getters,
      {
        hasEntity,
        _addEntity,
        _removeEntity,
      }
    )
  );
}

