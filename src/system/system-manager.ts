/**
 * @name        SystemManager
 * @description Manages the creation, destruction of Systems
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { clamp } from "../utils/numbers";
import { isValidName } from "../utils/strings";
import { World } from "../world";
import { createSystem, System, SystemSpec } from "./system";

export type SystemRegistry = { [name: string]: System };

export interface SystemManager {
  getSystems: () => System[];
  getPostSystems: () => System[];
  getPreSystems: () => System[];
  getUpdateSystems: () => System[];
  getSystemByIdx: (idx: number) => System | undefined;
  getSystemByName: (name: string) => System | undefined;
  isSystemRegistered: (system: System) => boolean;
  moveSystem: (system: System, idx: number) => number;
  registerSystem: (spec: SystemSpec) => System;
  unregisterSystem: (system: System) => World;
}

function _getSystems(executionOrder: System[]) {
  /** @returns an array of all systems in the world */
  function getSystems(): System[] {
    return [...executionOrder];
  }
  return getSystems;
}

function _getPostSystems(executionOrder: System[]) {
  /** @returns an array of all enabled systems which have a custom post-update function */
  function getPostSystems(): System[] {
    return executionOrder.filter((system) => "post" in system);
  }
  return getPostSystems;
}

function _getPreSystems(executionOrder: System[]) {
  /** @returns an array of all enabled systems which have a custom pre-update function */
  function getPreSystems(): System[] {
    return executionOrder.filter((system) => "pre" in system);
  }
  return getPreSystems;
}

function _getUpdateSystems(executionOrder: System[]) {
  /** @returns an array of all enabled systems which have a custom update function */
  function getUpdateSystems(): System[] {
    return executionOrder.filter((system) => "update" in system);
  }
  return getUpdateSystems;
}

function _getSystemByIdx(executionOrder: System[]) {
  /**
   * @returns a system by its execution index
   * @param idx the system's index in the execution order array
   */
  function getSystemByIdx(idx: number): System | undefined {
    return executionOrder[idx];
  }
  return getSystemByIdx;
}

function _getSystemByName(registry: SystemRegistry) {
  /** @returns a system by its name */
  function getSystemByName(name: string): System | undefined {
    return registry[name];
  }
  return getSystemByName;
}

function _isSystemRegistered(registry: SystemRegistry) {
  /** @returns true if a system is registered in this world */
  function isSystemRegistered(system: System): boolean {
    return system.name in registry;
  }
  return isSystemRegistered;
}

function _moveSystem(executionOrder: System[]) {
  /**
   * Change a system's execution order.
   * (N.B., if the given idx is greater than the current number of systems
   * the system will be moved to the last position)
   * @param system the system to move
   * @param idx the execution position.
   * @returns the systems new execution position
   */
  function moveSystem(system: System, idx: number): number {
    const current = executionOrder.indexOf(system);
    if (current === -1) return -1;
    const tmp = clamp(idx, 0, executionOrder.length);
    executionOrder.splice(tmp, 1);
    executionOrder.splice(current, 0, system);
    return tmp;
  }
  return moveSystem;
}

function _registerSystem(executionOrder: System[], registry: SystemRegistry) {
  /**
   * Creates and registers a new system
   * @param spec the system specification
   * @returns the new system
   */
  function registerSystem(spec: SystemSpec, idx?: number): System {
    if (!isValidName(spec.name)) {
      throw new SyntaxError(`"${spec.name}" is not a valid system name.`);
    }
    if (spec.name in registry) {
      throw new Error(`System "${spec.name}" is already registered!`);
    }
    if (!spec.pre && !spec.post && !spec.update) {
      throw new SyntaxError('No functions provided for system. Please provide a "pre"');
    }
    const system = createSystem(spec);
    if (idx !== undefined) {
      executionOrder.splice(clamp(idx, 0, executionOrder.length), 0, system);
    } else {
      executionOrder.push(system);
    }
    registry[system.name] = system;
    return system;
  }
  return registerSystem;
}

function _unregisterSystem(executionOrder: System[], registry: SystemRegistry, world: World) {
  /**
   * Unregister a given system
   * @returns the world
   */
  function unregisterSystem(system: System): World {
    if (!(system.name in registry)) {
      throw new Error(`System "${system.name}" is not registered!`);
    }
    delete registry[system.name];
    const idx = executionOrder.indexOf(system);
    if (idx > -1) executionOrder.splice(idx, 1);
    return world;
  }
  return unregisterSystem;
}

export function createSystemManager(world: World): SystemManager {
  const executionOrder: System[] = [];
  const registry: SystemRegistry = {};

  return {
    getSystems: _getSystems(executionOrder),
    getPostSystems: _getPostSystems(executionOrder),
    getPreSystems: _getPreSystems(executionOrder),
    getUpdateSystems: _getUpdateSystems(executionOrder),
    getSystemByIdx: _getSystemByIdx(executionOrder),
    getSystemByName: _getSystemByName(registry),
    isSystemRegistered: _isSystemRegistered(registry),
    moveSystem: _moveSystem(executionOrder),
    registerSystem: _registerSystem(executionOrder, registry),
    unregisterSystem: _unregisterSystem(executionOrder, registry, world),
  };
}
