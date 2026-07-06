import { $_SYSTEM_DESTROY_KEY, $_SYSTEM_INIT_KEY } from "@/constants.ts";
import { AlreadyRegisteredError, formatSystemNotRegistered, NotRegisteredError } from "@/errors.ts";
import type { ComponentMap } from "@/types/component.ts";
import type { SystemCallback, SystemInstance, TypedSystemCallback } from "@/types/system.ts";
import type { SystemBindings } from "@/types/system.ts";
import type { UntypedQueryComponents } from "@/types/query.ts";
import type { WorldContext } from "@/types/world-api.ts";
import { createSystemInstance, type System } from "./system.ts";

type SystemRegistration = {
  destroy: (world: WorldContext) => void | Promise<void>;
  init: (world: WorldContext) => void | Promise<void>;
  instance: SystemInstance<TypedSystemCallback<UntypedQueryComponents, unknown[], unknown>>;
  name: string;
  system: System<UntypedQueryComponents, unknown[], unknown>;
};

type LifecycleErrorHandler = (error: unknown) => void;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as PromiseLike<unknown>).then === "function";
}

/** The SystemManager is responsible for creating, registering, initializing, and destroying systems. */
export class SystemManager {
  /** The World that owns this system manager. */
  #world: WorldContext;

  /** Internal world bindings used while constructing system instances. */
  #bindings: SystemBindings;

  /** Internal system registration records keyed by system name. */
  #records: Record<string, SystemRegistration>;

  /** Internal mutable system registry keyed by system name. */
  #registry: Record<string, SystemInstance<SystemCallback>>;

  /** Frozen public registry view keyed by system name. */
  #publicRegistry: Readonly<Record<string, SystemInstance<SystemCallback>>>;

  /** Notifies the owning world about asynchronous lifecycle failures. */
  #onLifecycleError: LifecycleErrorHandler;

  /**
   * Create a new SystemManager
   * @param world The world to create the system manager in
   * @param bindings Internal bindings used to resolve query data for systems
   */
  constructor(world: WorldContext, bindings: SystemBindings, onLifecycleError: LifecycleErrorHandler = () => {}) {
    this.#world = world;
    this.#bindings = bindings;
    this.#records = {};
    this.#registry = {};
    this.#publicRegistry = Object.freeze({});
    this.#onLifecycleError = onLifecycleError;
  }

  /** @returns a frozen record of all system instances by name */
  get registry(): Readonly<Record<string, SystemInstance<SystemCallback>>> {
    return this.#publicRegistry;
  }

  /** Refresh the public registry view after cold-path system registry changes. */
  #refreshPublicRegistry(): void {
    this.#publicRegistry = Object.freeze({ ...this.#registry });
  }

  /** Remove a current record by identity so stale async failures cannot delete replacement systems. */
  #unregisterRecord(record: SystemRegistration): boolean {
    if (this.#records[record.name] !== record) return false;
    delete this.#records[record.name];
    delete this.#registry[record.name];
    this.#refreshPublicRegistry();
    return true;
  }

  /** Run init for a system registered after world initialization. */
  #initLateRecord(record: SystemRegistration): void {
    try {
      const initResult = record.init(this.#world);
      if (isPromiseLike(initResult)) {
        void Promise.resolve(initResult).catch((error) => {
          if (this.#unregisterRecord(record)) {
            this.#onLifecycleError(error);
          }
        });
      }
    } catch (error) {
      if (this.#unregisterRecord(record)) {
        this.#onLifecycleError(error);
      }
      throw error;
    }
  }

  /**
   * Create a system instance
   * @param system The system to create the instance of
   * @returns The created system instance
   * @throws {NoComponentsFoundError} If the system query returns no components
   */
  create<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn>): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>> {
    const existing = this.#records[system.name];
    if (existing) {
      throw new AlreadyRegisteredError(`System "${system.name}" is already registered in the world.`);
    }
    const instance = createSystemInstance(this.#bindings, system);
    this.#records[system.name] = {
      destroy: system[$_SYSTEM_DESTROY_KEY],
      init: system[$_SYSTEM_INIT_KEY],
      instance: instance as SystemInstance<TypedSystemCallback<UntypedQueryComponents, unknown[], unknown>>,
      name: system.name,
      system: system as System<UntypedQueryComponents, unknown[], unknown>,
    };
    this.#registry[system.name] = instance as unknown as SystemInstance<SystemCallback>;
    this.#refreshPublicRegistry();
    if (this.#world.state === "initialized") {
      this.#initLateRecord(this.#records[system.name]!);
    }
    return instance;
  }

  /**
   * Destroy a system instance
   * @param system The system to destroy
   */
  async destroy<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(
    system: System<TComponents, TArgs, TReturn> | string,
    throwOnNotFound = true,
  ): Promise<void> {
    const record = this.#getRecord(system);
    if (record === undefined) {
      if (throwOnNotFound === false) return;
      const name = typeof system === "string" ? system : system.name;
      throw new NotRegisteredError(formatSystemNotRegistered(name));
    }
    await record.destroy(this.#world);
    delete this.#records[record.name];
    delete this.#registry[record.name];
    this.#refreshPublicRegistry();
  }

  /**
   * Destroy all systems
   */
  async destroyAll(): Promise<void> {
    let pending: Promise<unknown> = Promise.resolve();
    for (const name of Object.keys(this.#records)) {
      pending = pending.then(() => this.destroy(name));
    }
    await pending;
  }

  /**
   * Get a system instance
   * @param system The system to get the instance of
   * @returns The system instance
   */
  get(system: string): SystemInstance<SystemCallback> | undefined;
  get<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn>):
    | SystemInstance<
      TypedSystemCallback<TComponents, TArgs, TReturn>
    >
    | undefined;
  get<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: string | System<TComponents, TArgs, TReturn>):
    | SystemInstance<SystemCallback>
    | SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>
    | undefined;
  get(system: string | System<ComponentMap, unknown[], unknown>):
    | SystemInstance<SystemCallback>
    | SystemInstance<TypedSystemCallback<ComponentMap, unknown[], unknown>>
    | undefined {
    return this.#getRecord(system)?.instance as
      | SystemInstance<SystemCallback>
      | SystemInstance<TypedSystemCallback<ComponentMap, unknown[], unknown>>
      | undefined;
  }

  /**
   * Check if a system is registered
   * @param system The system to check
   * @returns Whether the system is registered
   */
  has<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: string | System<TComponents, TArgs, TReturn>): boolean {
    return this.get(system) !== undefined;
  }

  /**
   * Initialize all systems
   */
  async init(): Promise<void> {
    let pending: Promise<unknown> = Promise.resolve();
    for (const record of Object.values(this.#records)) {
      pending = pending.then(() => record.init(this.#world));
    }
    await pending;
  }

  /** Resolve a registration by exact system object or name. */
  #getRecord<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: string | System<TComponents, TArgs, TReturn>): SystemRegistration | undefined {
    if (typeof system === "string") {
      return this.#records[system];
    }
    const record = this.#records[system.name];
    return record?.system === system ? record : undefined;
  }
}
