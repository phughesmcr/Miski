// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from './entity';
import { World } from './world';

/** A property specifically for the worldEntity */
export interface WorldComponent {
  /** The associated world object */
  world: World,
}

/** Component specification object */
export type ComponentSpec<T = Record<string, unknown>> = Omit<InternalComponentSpec<T>, "id">;

/** Internal component specification object */
interface InternalComponentSpec<T = Record<string, unknown>> {
  /** The maximum entities component can attach to */
  entityLimit?: number | bigint | null,
  /** The component's id */
  id: bigint,
  /** The component's name */
  name: string,
  /** The component's property object */
  properties: T,
  /** Is the component removable once attached? */
  removable?: boolean,
}

export interface Component<T = Record<string, unknown>> {
  /** An array of entities associated with this component */
  entities: Entity[],
  /** The maximum entities component can attach to */
  entityLimit: number | bigint | null | undefined,
  /** The component's id */
  id: Readonly<bigint>,
  /** The component's name */
  name: Readonly<string>,
  /** The component's property object */
  properties: T,
  /** Is the component removable once attached? */
  removable: boolean,
  /** @hidden */
  _addEntity(entity: Entity): void,
  /** @hidden */
  _removeEntity(entity: Entity): void,
  /** Check if an entity is associated with this category */
  hasEntity(entity: Entity): boolean
  /** Set the maximum entities component can attach to */
  setEntityLimit(limit: number | bigint | null): void,
}

/**
 * Creates a new component object
 * @param spec the components specification object
 */
export function _createComponent<T = Record<string, unknown>>(spec: InternalComponentSpec<T>): Component<T> {
  const { id, name, properties } = { ...spec };
  let {
    entityLimit = null,
    removable = true,
  } = { ...spec };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const { entities } = { entities: new Set() as Set<Entity> };

  const getters = {
    /** @returns the component's id */
    get id(): bigint {
      return id;
    },

    /** @returns the component's name */
    get name(): string {
      return name;
    },

    /** @returns an array of entities associated with this component */
    get entities(): Entity[] {
      return Array.from(entities);
    },

    /** @returns the maximum entities this component can attach to */
    get entityLimit(): number | bigint | null | undefined {
      return entityLimit;
    },

    /** @returns the default properties of this component */
    get properties(): T {
      return properties;
    },

    /** @returns can the component be removed from entities once attached? */
    get removable(): boolean {
      return removable;
    },
  };

  /**
   * @hidden
   * Associate an entity with this component
   * @param entity the entity to associate
   * @returns this component
   */
  const _addEntity = function(entity: Entity): void {
    if (entityLimit != null && entities.size >= entityLimit) {
      throw new Error(`component "${name}" has reached its entity limit of ${entityLimit}.`);
    }
    entities.add(entity);
  };

  /**
   * @hidden
   * Disassociate an entity from this component
   * @param entity the entity to disassociate
   * @returns this component
   */
  const _removeEntity = function(entity: Entity): void {
    if (!removable) {
      throw new Error(`component ${name} is not removable.`);
    }
    entities.delete(entity);
  };

  /**
   * Check if an entity is associated with this component
   * @param entity the entity to test for
   */
  const hasEntity = function(entity: Entity): boolean {
    return entities.has(entity);
  };

  /**
   * Set the maximum number of entities this component can be associated with at one time
   * @param limit the limit or null to remove the limit
   */
  const setEntityLimit = function(limit: number | bigint | null): void {
    entityLimit = limit;
  };

  /**
   * Set whether the component be removed from entities once attached
   * @param isRemovable boolean - true = removable
   */
  const setRemovable = function(isRemovable: boolean): void {
    removable = isRemovable;
  };

  return Object.freeze(
    Object.assign(
      getters,
      {
        hasEntity,
        setEntityLimit,
        setRemovable,
        _addEntity,
        _removeEntity,
      }
    )
  );
}
