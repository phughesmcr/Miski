// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { clamp, validName } from '../utils';
import { World } from '../world';
import { noopPost, noopPre, noopUpdate, System, SystemSpec } from './system';

export interface SystemManagerSpec {
  [key: string]: unknown;
}

export interface SystemManager {
  /** @returns an array of all systems in the world */
  getSystems: () => System[];
  /** @returns an array of all enabled systems which have a custom post-update function */
  getPostSystems: () => System[];
  /** @returns an array of all enabled systems which have a custom pre-update function */
  getPreSystems: () => System[];
  /** @returns an array of all enabled systems which have a custom update function */
  getUpdateSystems: () => System[];
  /**
   * @returns a system by its execution index
   * @param idx the system's index in the execution order array
   */
  getSystemByIdx: (idx: number) => System | undefined;
  /** @returns a system by its name */
  getSystemByName: (name: string) => System | undefined;
  /** @returns true if a system is registered in this world */
  isSystemRegistered: (system: System) => boolean;
  /**
   * Change a system's execution order.
   * (N.B., if the given idx is greater than the current number of systems
   * the system will be moved to the last position)
   * @param system the system to move
   * @param idx the execution position.
   * @returns the systems new execution position
   */
  moveSystem: (system: System, idx: number) => number;
  /**
   * Creates and registers a new system
   * @param spec the system specification
   * @returns the new system
   */
  registerSystem: (spec: SystemSpec) => System;
  /**
   * Unregisters a given system
   * @returns the world
   */
  unregisterSystem: (system: System) => World;
}

function createGetSystems(executionOrder: System[]) {
  return function getSystems(): System[] {
    return [...executionOrder];
  };
}

function createGetPostSystems(executionOrder: System[]) {
  return function getPostSystems(): System[] {
    return executionOrder.filter((system) => {
      return system.post && system.post !== noopPost && system.enabled;
    });
  };
}

function createGetPreSystems(executionOrder: System[]) {
  return function getPreSystems(): System[] {
    return executionOrder.filter((system) => {
      return system.pre && system.pre !== noopPre && system.enabled;
    });
  };
}

function createGetUpdateSystems(executionOrder: System[]) {
  return function getUpdateSystems(): System[] {
    return executionOrder.filter((system) => {
      return system.update && system.update !== noopUpdate && system.enabled;
    });
  };
}

function createGetSystemByIdx(executionOrder: System[]) {
  return function getSystemByIdx(idx: number): System | undefined {
    return executionOrder[idx];
  };
}

function createGetSystemByName(registry: Map<string, System>) {
  return function getSystemByName(name: string): System | undefined {
    return registry.get(name);
  };
}

function createIsSystemRegistered(registry: Map<string, System>) {
  return function isSystemRegistered(system: System): boolean {
    return registry.has(system.name) || [...registry.values()].includes(system);
  };
}

function createMoveSystem(executionOrder: System[]) {
  return function moveSystem(system: System, idx: number): number {
    const current = executionOrder.indexOf(system);
    if (current === -1) return -1;
    const tmp = clamp(idx, 0, executionOrder.length);
    executionOrder.splice(tmp, 1);
    executionOrder.splice(current, 0, system);
    return tmp;
  };
}

function createRegisterSystem(executionOrder: System[], registry: Map<string, System>, world: World) {
  return function registerSystem(spec: SystemSpec, idx?: number): System {
    if (!validName(spec.name)) {
      throw new SyntaxError(`"${spec.name}" is not a valid system name.`);
    }
    if (registry.has(spec.name)) {
      throw new Error(`System "${spec.name}" is already registered!`);
    }
    const system = new System(world, spec);
    if (idx !== undefined) {
      executionOrder.splice(clamp(idx, 0, executionOrder.length), 0, system);
    } else {
      executionOrder.push(system);
    }
    registry.set(system.name, system);
    return system;
  };
}

function createUnregisterSystem(executionOrder: System[], registry: Map<string, System>, world: World) {
  return function unregisterSystem(system: System): World {
    if (!registry.has(system.name)) {
      throw new Error(`System "${system.name}" is not registered!`);
    }
    registry.delete(system.name);
    const idx = executionOrder.indexOf(system);
    if (idx > -1) executionOrder.splice(idx, 1);
    return world;
  };
}

export function createSystemManager(world: World, _spec: SystemManagerSpec): SystemManager {
  const executionOrder: System[] = [];
  const registry: Map<string, System> = new Map();

  return {
    getSystems: createGetSystems(executionOrder),
    getPostSystems: createGetPostSystems(executionOrder),
    getPreSystems: createGetPreSystems(executionOrder),
    getUpdateSystems: createGetUpdateSystems(executionOrder),
    getSystemByIdx: createGetSystemByIdx(executionOrder),
    getSystemByName: createGetSystemByName(registry),
    isSystemRegistered: createIsSystemRegistered(registry),
    moveSystem: createMoveSystem(executionOrder),
    registerSystem: createRegisterSystem(executionOrder, registry, world),
    unregisterSystem: createUnregisterSystem(executionOrder, registry, world),
  };
}
