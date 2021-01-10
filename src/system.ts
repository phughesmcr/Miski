// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from './component';
import { Entity } from './entity';
import { createMask } from './mask';

export type SystemSpec = Omit<InternalSystemSpec, "id">;

interface InternalSystemSpec {
  id: bigint,
  updateFn?: (dt: number, entities: Entity[]) => void,
  renderFn?: (int: number, entities: Entity[]) => void,
  components: Component<unknown>[],
}

export type System = Readonly<{
  archetype: bigint,
  enabled: boolean,
  id: bigint,
  enable(): void,
  disable(): void,
  update(dt: number, entities: Entity[]): void,
  render(int: number, entities: Entity[]): void,
}>;

export function _createSystem(spec: InternalSystemSpec): System {
  const {
    id,
    components = [],
    updateFn = ((dt, entities) => void 0),
    renderFn = ((int, entities) => void 0),
  } = spec;

  const { archetype } = { archetype: createMask(0n) };
  let { enabled } = { enabled: false };

  components.forEach((component) => archetype.set(component.id));

  const getters = {
    get id(): bigint {
      return id;
    },

    get archetype(): bigint {
      return archetype.value;
    },

    get enabled(): boolean {
      return enabled;
    },
  };

  const enable = function(): void {
    enabled = true;
  };

  const disable = function(): void {
    enabled = false;
  };

  const update = function(dt: number, entities: Entity[]): void {
    updateFn(dt, entities);
  };

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
