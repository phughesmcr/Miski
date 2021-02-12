// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { createSystem, System, SystemSpec } from './system';

export interface SystemManager {
    registerSystem: (spec: SystemSpec, idx?: number | undefined) => System;
    unregisterSystem: (system: System) => void;
    moveSystem: (system: System, index: number) => boolean;
    isSystemRegistered: (system: System) => boolean;
    getSystemByName: (name: string) => System | undefined;
    getSystemByIndex: (index: number) => System | undefined;
    getSystems: () => System[];
}

export function createSystemManager(): SystemManager {
  const _registry: Record<string, System> = {};
  const _executionOrder: System[] = [];

  const registerSystem = (spec: SystemSpec, idx?: number): System => {
    if (spec.name in _registry) {
      throw new Error(`system "${spec.name}" is already registered!`);
    }
    const system = createSystem({...spec});
    if (idx !== undefined) {
      _executionOrder.splice(idx, 0, system);
    } else {
      _executionOrder.push(system);
    }
    _registry[system.name] = system;
    return system;
  };

  const unregisterSystem = (system: System): void => {
    if (!(system.name in _registry)) {
      throw new Error(`system "${system.name}" is not registered!`);
    }
    delete _registry[system.name];
    _executionOrder.splice(_executionOrder.indexOf(system), 1);
  };

  const moveSystem = (system: System, index: number): boolean => {
    const idx = _executionOrder.indexOf(system);
    if (idx === -1) return false;
    _executionOrder.splice(idx, 1);
    _executionOrder.splice(index, 0, system);
    return true;
  };

  const getSystemByName = (name: string): System | undefined => _registry[name];

  const getSystemByIndex = (index: number): System | undefined => _executionOrder[index] ?? undefined;

  const getSystems = (): System[] => [..._executionOrder];

  const isSystemRegistered = (system: System): boolean => system.name in _registry;

  return Object.freeze({
    registerSystem,
    unregisterSystem,
    moveSystem,
    isSystemRegistered,
    getSystemByName,
    getSystemByIndex,
    getSystems,
  });
}
