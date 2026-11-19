import type { System } from "@/system/system.ts";
import type { ComponentMap } from "@/types/component.ts";
import type { SystemCallback, SystemInstance, SystemRecord, TypedSystemCallback } from "@/types/system.ts";

/**
 * The public System management API: `world.systems` owns system lifecycles (registration, `init` and `destroy`
 * hooks). Run systems with a `Schedule`, which registers them here as needed.
 *
 * {@link register} also returns the system's instance, which runs the system when called. A direct call bypasses
 * everything a `Schedule` adds: enabled state, `runIf`, ordering, phases, the shared command buffer and the
 * end-of-run `world.refresh()`. Use it for tests, tools or a hand-written loop.
 */
export type WorldSystemAPI = {
  /** The registered system instances by name */
  readonly registry: SystemRecord;
  /**
   * Register a system and return its instance. Runs the system's `init` hook now if the world is already
   * initialized; otherwise `world.init()` runs it.
   * @throws {AlreadyRegisteredError} If a system with the same name is already registered
   * @throws {NotRegisteredError} If a component in the system query is not registered in the world
   * @throws {WorldStateError} If the world is being or has been destroyed
   */
  register<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn>): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>;
  /** Get a registered system's instance, or `undefined` if it is not registered */
  get(system: string): SystemInstance<SystemCallback> | undefined;
  get<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(
    system: System<TComponents, TArgs, TReturn>,
  ): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>> | undefined;
  /** Check if a system is registered */
  has<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): boolean;
  /**
   * Destroy a system, waiting for its pending init or destroy hook first.
   * Every failure is reported as a rejection, never a synchronous throw.
   * @returns `true` once the system is destroyed, or `false` if it was not registered
   * @throws {WorldStateError} If the world is being or has been destroyed, or if called from a pending system hook
   * whose own completion the destruction would wait on (for example, a hook destroying its own system). This is
   * detected in the synchronous part of a hook, or after an `await` through `SystemHookContext.destroySystem()`.
   */
  destroy<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): Promise<boolean>;
  /**
   * Like {@link destroy}, but rejects if the system is not registered.
   * @throws {NotRegisteredError} If the system is not registered
   * @throws {WorldStateError} As for {@link destroy}
   */
  destroyOrThrow<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): Promise<void>;
};
