// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { createSystem, System, SystemSpec } from './system';

export interface SystemManager {
    getSystemByIndex: (index: number) => System | undefined;
    getSystemByName: (name: string) => System | undefined;
    getSystems: () => System[];
    isSystemRegistered: (system: System) => boolean;
    moveSystem: (system: System, index: number) => boolean;
    registerSystem: (spec: SystemSpec, idx?: number | undefined) => System;
    unregisterSystem: (system: System) => void;
}

/** Create a system manager */
export function createSystemManager(): SystemManager {
  /** Container for all the systems indexed by system name */
  const _registry: Record<string, System> = {};

  /** Array of systems by execution order */
  const _executionOrder: System[] = [];

  /**
   * Creates and registers a system
   * @param spec the system specification
   * @param idx the execution order, defaults to last in list
   */
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

  /**
   * Unregister a system
   * @param system the system to unregister
   */
  const unregisterSystem = (system: System): void => {
    if (!(system.name in _registry)) {
      throw new Error(`system "${system.name}" is not registered!`);
    }
    delete _registry[system.name];
    _executionOrder.splice(_executionOrder.indexOf(system), 1);
  };

  /**
   * Move a system in the execution order
   * @param system the system to move
   * @param index the execution order of the system
   */
  const moveSystem = (system: System, index: number): boolean => {
    const idx = _executionOrder.indexOf(system);
    if (idx === -1) return false;
    _executionOrder.splice(idx, 1);
    _executionOrder.splice(index, 0, system);
    return true;
  };

  /**
   * Find a system by name
   * @param name the system name to search for
   */
  const getSystemByName = (name: string): System | undefined => _registry[name];

  /**
   * Get system by execution order
   * @param index the execution order
   */
  const getSystemByIndex = (index: number): System | undefined => _executionOrder[index] ?? undefined;

  /** Returns an array of all systems in order of execution*/
  const getSystems = (): System[] => [..._executionOrder];

  /**
   * Check if a system is registered
   * @param system the system to check for
   */
  const isSystemRegistered = (system: System): boolean => system.name in _registry;

  return Object.freeze({
    getSystemByIndex,
    getSystemByName,
    getSystems,
    isSystemRegistered,
    moveSystem,
    registerSystem,
    unregisterSystem,
  });
}
