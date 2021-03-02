// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from '../component/component';
import { Entity } from '../entity/entity';
import { createMask } from '../utils/mask';

export type System = Readonly<{
  archetype: bigint;
  disable: () => boolean;
  enable: () => boolean;
  enabled: boolean;
  exclusive: boolean;
  name: string;
  postUpdate: (int: number, entities: Entity[], system: System) => void;
  preUpdate: (entities: Entity[], system: System) => void;
  update: (dt: number, entities: Entity[], system: System) => void;
}>

export interface SystemSpec {
  components: Component<unknown>[];
  exclusive?: boolean;
  name: string;
  postUpdate?: (int: number, entity: Entity[], system: System) => void;
  preUpdate?: (entities: Entity[], system: System) => void;
  update?: (dt: number, entities: Entity[], system: System) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const _noop = function() {};

/**
 * Creates a new system
 * @param spec the system specification object
 */
export function createSystem(spec: SystemSpec): System {
  const {
    components,
    exclusive = false,
    name,
    postUpdate = _noop,
    preUpdate = _noop,
    update = _noop,
  } = { ...spec };

  // construct system archetype
  const _archetype = components.reduce((archetype, component) => {
    archetype.on(component.id);
    return archetype;
  }, createMask()).value();

  // system status
  let _enabled = false;

  /** Enable the system */
  const enable = (): boolean => _enabled = true;

  /** Disable the system */
  const disable = (): boolean => _enabled = false;

  return Object.freeze({
    get enabled(): boolean {
      return _enabled;
    },
    archetype: _archetype,
    disable,
    enable,
    exclusive,
    name,
    postUpdate,
    preUpdate,
    update,
  });
}