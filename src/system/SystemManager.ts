/**
 * @module      SystemManager
 * @description The SystemManager is responsible for creating and destroying systems.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "../constants.ts";
import { createSystemInstance, type System } from "./System.ts";
import { NotRegisteredError } from "../errors.ts";
import type { SystemCallback, SystemInstance } from "../types.ts";
import type { World } from "../world/World.ts";

/** The SystemManager is responsible for creating, registering, initializing, and destroying systems. */
export class SystemManager {
  registry: Record<string, SystemInstance<any>>;

  /**
   * Create a new SystemManager
   * @param world The world to create the system manager in
   */
  constructor(world: World) {
    this.registry = {};

    this.create = <T extends SystemCallback>(system: System<T>): SystemInstance<T> => {
      const existing = this.get(system);
      if (existing) {
        return existing;
      }
      const instance = createSystemInstance(world, system);
      this.registry[system.name] = instance as SystemInstance<any>;
      return instance as SystemInstance<T>;
    };

    this.destroy = async <T extends SystemCallback>(
      system: System<T> | string,
      throwOnNotFound = true,
    ): Promise<void> => {
      const instance = this.get(system);
      if (instance === undefined) {
        if (throwOnNotFound === false) return;
        const name = typeof system === "string" ? system : system.name;
        throw new NotRegisteredError(`System "${name}" is not registered in the world`);
      }
      const proto = Object.getPrototypeOf(instance);
      await proto[$_SYSTEM_DESTROY_KEY](world);
      delete this.registry[proto.name];
    };

    this.destroyAll = async (): Promise<void> => {
      for (const instance of Object.values(this.registry)) {
        const proto = Object.getPrototypeOf(instance);
        await this.destroy(proto.name);
      }
    };
  }

  /**
   * Create a system instance
   * @param system The system to create the instance of
   * @returns The created system instance
   * @throws {NoComponentsFoundError} If the system query returns no components
   */
  create: <T extends SystemCallback>(system: System<T>) => SystemInstance<T>;

  /**
   * Destroy a system instance
   * @param system The system to destroy
   */
  destroy: <T extends SystemCallback>(system: System<T> | string, throwOnNotFound?: boolean) => Promise<void>;

  /**
   * Destroy all systems
   */
  destroyAll: () => Promise<void>;

  /**
   * Get a system instance
   * @param system The system to get the instance of
   * @returns The system instance
   */
  get = <T extends SystemCallback>(system: string | System<T>): SystemInstance<T> | undefined => {
    if (typeof system === "string") {
      return this.registry[system];
    }
    const result = this.registry[system.name];
    if (result && Object.getPrototypeOf(result) !== system) {
      return undefined;
    }
    return result;
  };

  /**
   * Check if a system is registered
   * @param system The system to check
   * @returns Whether the system is registered
   */
  has = <T extends SystemCallback>(system: string | System<T>): boolean => {
    return this.get(system) !== undefined;
  };

  /**
   * Initialize all systems
   * @param world The world to initialize the systems in
   */
  init = async (world: World): Promise<void> => {
    for (const instance of Object.values(this.registry)) {
      const system: System<any> = Object.getPrototypeOf(instance);
      await system[$_SYSTEM_INIT_KEY](world);
    }
  };
}
