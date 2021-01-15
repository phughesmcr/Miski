// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from './component';
import { Entity } from './entity';
import { createMask } from './mask';

export type SystemSpec = Omit<InternalSystemSpec, "id">;

interface InternalSystemSpec {
  /** The system's required components */
  components?: Component<unknown>[],
  /** The system's id */
  id: bigint,
  /** A name / label for the system */
  name: string,
  /** The system's render function */
  renderFn?: (int: number, entities: Entity[]) => void,
  /** The system's update function */
  updateFn?: (dt: number, entities: Entity[]) => void,
}

export type System = Readonly<{
  /** The system's associated entity archetype */
  archetype: bigint,
  /** Is the system enabled? */
  enabled: boolean,
  /** The system's id */
  id: bigint,
  /** The name / label of the system */
  name: string,
  /** Disable the system */
  disable(): void,
  /** Enable the system */
  enable(): void,
  /** The system's render function */
  render(int: number, entities: Entity[]): void,
  /** The system's update function */
  update(dt: number, entities: Entity[]): void,
}>;

/**
 * Creates a new system object
 * @param spec the system specification object
 */
export function _createSystem(spec: InternalSystemSpec): System {
  const {
    components = [],
    id,
    name,
    updateFn = (() => void 0),
    renderFn = (() => void 0),
  } = { ...spec };

  const archetype = createMask(0n);
  components.forEach((component) => archetype.set(component.id));

  let enabled = false;

  const getters = {
    /** @returns the system's archetype */
    get archetype(): bigint {
      return archetype.value;
    },

    /** @returns whether the system is enabled or not */
    get enabled(): boolean {
      return enabled;
    },

    /** @returns the system's id */
    get id(): bigint {
      return id;
    },

    /** @returns the system's name */
    get name(): string {
      return name;
    },
  };

  /** Enable the system */
  const enable = function(): void {
    enabled = true;
  };

  /** Disable the system */
  const disable = function(): void {
    enabled = false;
  };

  /** Call the system's update function */
  const update = function(dt: number, entities: Entity[]): void {
    updateFn(dt, entities);
  };

  /** Call the system's render function */
  const render = function(int: number, entities: Entity[]): void {
    renderFn(int, entities);
  };

  return Object.freeze(
    Object.assign(
      getters,
      {
        enable,
        disable,
        update,
        render,
      }
    )
  );
}
