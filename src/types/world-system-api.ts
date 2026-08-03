import type { System } from "@/system/system.ts";
import type { ComponentMap } from "@/types/component.ts";
import type { SystemCallback, SystemInstance, SystemRecord, TypedSystemCallback } from "@/types/system.ts";

/** The public System management API */
export type WorldSystemAPI = {
  /** The systems by name */
  readonly registry: SystemRecord;
  /** Create a system */
  create<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn>): SystemInstance<TypedSystemCallback<TComponents, TArgs, TReturn>>;
  /** Get a system instance */
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
  /** Destroy a system */
  destroy<
    TComponents extends ComponentMap,
    TArgs extends unknown[],
    TReturn,
  >(system: System<TComponents, TArgs, TReturn> | string): Promise<void>;
};
