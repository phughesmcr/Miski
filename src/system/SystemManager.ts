/**
 * @module      SystemManager
 * @description The SystemManager is responsible for creating and destroying systems.
 * @copyright   2024 the Miski authors. All rights reserved
 * @license     MIT
 */

import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "../constants.ts";
import { createSystemInstance, type System } from "./System.ts";
import { NotRegisteredError } from "../errors.ts";
import type { ComponentRecord, Entity, ParametersExceptFirstTwo, SystemInstance } from "../types.ts";
import type { World } from "../world/World.ts";

export class SystemManager {
  // deno-lint-ignore no-explicit-any
  #registry: Record<string, SystemInstance<any, any>>;

  constructor() {
    this.#registry = {};
  }

  /**
   * Initialize all systems
   * @param world The world to initialize the systems in
   */
  async init(world: World): Promise<void> {
    for (const instance of Object.values(this.#registry)) {
      // deno-lint-ignore no-explicit-any
      const system: System<any, any> = Object.getPrototypeOf(instance);
      await system[$_SYSTEM_INIT_KEY](world);
    }
  }

  /**
   * Create a system instance
   * @param world The world to create the system instance in
   * @param system The system to create the instance of
   * @returns The created system instance
   * @throws {NoComponentsFoundError} If the system query returns no components
   */
  create<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(world: World, system: System<T, U>): SystemInstance<T, U> {
    const existing = this.get(system);
    if (existing) {
      return existing;
    }
    const instance = createSystemInstance(world, system);
    this.#registry[system.name] = instance;
    return instance;
  }

  /**
   * Destroy a system instance
   * @param system The system to destroy
   */
  async destroy<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(world: World, system: System<T, U> | string, throwOnNotFound = true): Promise<void> {
    const instance = this.get(system);
    if (!instance) {
      if (!throwOnNotFound) return;
      const name = typeof system === "string" ? system : system.name;
      throw new NotRegisteredError(`System "${name}" is not registered in the world`);
    }
    const proto = Object.getPrototypeOf(instance);
    await proto[$_SYSTEM_DESTROY_KEY](world);
    delete this.#registry[proto.name];
  }

  /**
   * Destroy all systems
   * @param world The world to destroy the systems in
   */
  async destroyAll(world: World): Promise<void> {
    for (const instance of Object.values(this.#registry)) {
      await this.destroy(world, instance.name);
    }
  }

  /**
   * Get a system instance
   * @param system The system to get the instance of
   * @returns The system instance
   */
  get<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(system: string | System<T, U>): SystemInstance<T, U> | undefined {
    if (typeof system === "string") {
      return this.#registry[system];
    }
    const result = this.#registry[system.name];
    if (result && Object.getPrototypeOf(result) !== system) {
      return undefined;
    }
    return result;
  }

  /**
   * Check if a system is registered
   * @param system The system to check
   * @returns Whether the system is registered
   */
  has<
    T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>,
    U extends ParametersExceptFirstTwo<T>,
  >(system: string | System<T, U>): boolean {
    return this.get(system) !== undefined;
  }
}
