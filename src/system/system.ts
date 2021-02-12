// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Entity } from '../entity/entity';
import { Component } from '../component/component';
import { createMask } from '../mask';

export type System = Readonly<{
  archetype: bigint;
  enabled: boolean;
  exclusive: boolean;
  name: string;
  enable: () => void;
  disable: () => void;
  preUpdate: (entities: Entity[], system: System) => void;
  update: (dt: number, entities: Entity[], system: System) => void;
  postUpdate: (int: number, entities: Entity[], system: System) => void;
}>

export interface SystemSpec {
  components: Component<unknown>[];
  exclusive?: boolean;
  name: string;
  update?: (dt: number, entities: Entity[], system: System) => void;
  postUpdate?: (int: number, entity: Entity[], system: System) => void;
  preUpdate?: (entities: Entity[], system: System) => void;
}

export function createSystem(spec: SystemSpec): System {
  const {
    components,
    exclusive = false,
    name,
    update = (() => void 0),
    postUpdate = (() => void 0),
    preUpdate = (() => void 0),
  } = { ...spec };

  const _archetype = components.reduce((archetype, component) => {
    archetype.on(component.id);
    return archetype;
  }, createMask()).value();

  let _enabled = false;

  const enable = (): void => {
    _enabled = true;
  };

  const disable = (): void => {
    _enabled = false;
  };

  return Object.freeze({
    archetype: _archetype,
    exclusive,
    name,
    get enabled(): boolean {
      return _enabled;
    },
    disable,
    enable,
    preUpdate,
    update,
    postUpdate,
  });
}