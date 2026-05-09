/**
 * @module      SystemManager
 * @description The SystemManager is responsible for creating and destroying systems.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import { NotRegisteredError } from "@/errors.ts";
import type { AnySystemCallback, SystemInstance } from "@/types.ts";
import type { World } from "@/world/world.ts";
import { createSystemInstance, type System } from "./system.ts";

/** The SystemManager is responsible for creating, registering, initializing, and destroying systems. */
export class SystemManager {
  /** The World that owns this system manager. */
  #world: World;

  /** Internal component query callback used while public query APIs are unavailable. */
  #queryComponents: Parameters<typeof createSystemInstance>[2];

  /** Internal mutable system registry keyed by system name. */
  #registry: Record<string, SystemInstance<any>>;

  /** Frozen public registry view keyed by system name. */
  #publicRegistry: Readonly<Record<string, SystemInstance<any>>>;

  /**
   * Create a new SystemManager
   * @param world The world to create the system manager in
   */
  constructor(world: World, queryComponents: Parameters<typeof createSystemInstance>[2]) {
    this.#world = world;
    this.#queryComponents = queryComponents;
    this.#registry = {};
    this.#publicRegistry = Object.freeze({});
  }

  /** @returns a frozen record of all system instances by name */
  get registry(): Readonly<Record<string, SystemInstance<any>>> {
    return this.#publicRegistry;
  }

  /** Refresh the public registry view after cold-path system registry changes. */
  #refreshPublicRegistry(): void {
    this.#publicRegistry = Object.freeze({ ...this.#registry });
  }

  /**
   * Create a system instance
   * @param system The system to create the instance of
   * @returns The created system instance
   * @throws {NoComponentsFoundError} If the system query returns no components
   */
  create<T extends AnySystemCallback>(system: System<T>): SystemInstance<T> {
    const existing = this.get(system);
    if (existing) {
      return existing;
    }
    const instance = createSystemInstance(this.#world, system, this.#queryComponents);
    this.#registry[system.name] = instance as SystemInstance<any>;
    this.#refreshPublicRegistry();
    return instance as SystemInstance<T>;
  }

  /**
   * Destroy a system instance
   * @param system The system to destroy
   */
  async destroy<T extends AnySystemCallback>(
    system: System<T> | string,
    throwOnNotFound = true,
  ): Promise<void> {
    const instance = this.get(system);
    if (instance === undefined) {
      if (throwOnNotFound === false) return;
      const name = typeof system === "string" ? system : system.name;
      throw new NotRegisteredError(`System "${name}" is not registered in the world`);
    }
    const proto = Object.getPrototypeOf(instance);
    await proto[$_SYSTEM_DESTROY_KEY](this.#world);
    delete this.#registry[proto.name];
    this.#refreshPublicRegistry();
  }

  /**
   * Destroy all systems
   */
  async destroyAll(): Promise<void> {
    for (const instance of Object.values(this.#registry)) {
      const proto = Object.getPrototypeOf(instance);
      await this.destroy(proto.name);
    }
  }

  /**
   * Get a system instance
   * @param system The system to get the instance of
   * @returns The system instance
   */
  get<T extends AnySystemCallback>(system: string | System<T>): SystemInstance<T> | undefined {
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
  has<T extends AnySystemCallback>(system: string | System<T>): boolean {
    return this.get(system) !== undefined;
  }

  /**
   * Initialize all systems
   */
  async init(): Promise<void> {
    for (const instance of Object.values(this.#registry)) {
      const system: System<any> = Object.getPrototypeOf(instance);
      await system[$_SYSTEM_INIT_KEY](this.#world);
    }
  }
}
