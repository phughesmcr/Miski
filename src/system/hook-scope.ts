/**
 * Detection of code running inside a system lifecycle hook (`init` / `destroy`).
 *
 * A hook that awaits world readiness or teardown waits on itself: readiness and teardown both wait for the
 * pending hook. Where the runtime provides `AsyncLocalStorage` (Deno, Node, Bun) the async continuation of a
 * pending hook is tracked, so such calls can be rejected deterministically. Runtimes without it (e.g. browsers)
 * fall back to the teardown signal in the world, which rejects waiting `onReady` calls once teardown starts.
 */

import { isPromiseLike } from "@/utils.ts";

type HookScope = { active: boolean; owner: object | undefined };

type AsyncLocalStorageLike = {
  run<R>(store: HookScope, fn: () => R): R;
  getStore(): HookScope | undefined;
};

function createStorage(): AsyncLocalStorageLike | undefined {
  try {
    const host = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } };
    const mod = host.process?.getBuiltinModule?.("node:async_hooks") as
      | { AsyncLocalStorage?: new () => AsyncLocalStorageLike }
      | undefined;
    return mod?.AsyncLocalStorage ? new mod.AsyncLocalStorage() : undefined;
  } catch {
    return undefined;
  }
}

const storage = createStorage();

/**
 * Run a lifecycle hook, marking it and its asynchronous continuations as hook code until it settles.
 * Where scope tracking is unavailable the hook simply runs.
 * @param fn The hook to run
 * @param owner Optional token identifying this hook run, reported by `currentHookOwner()` while it is pending
 */
export function runInHookScope<T>(fn: () => T, owner?: object): T {
  if (storage === undefined) return fn();
  const scope: HookScope = { active: true, owner };
  const end = () => {
    scope.active = false;
  };
  let result: T;
  try {
    result = storage.run(scope, fn);
  } catch (error) {
    end();
    throw error;
  }
  if (isPromiseLike(result)) {
    result.then(end, end);
  } else {
    end();
  }
  return result;
}

/** Whether the caller is inside a system lifecycle hook that has not yet settled. */
export function isInHookScope(): boolean {
  return storage?.getStore()?.active === true;
}

/**
 * The owner token of the pending lifecycle hook the caller is running inside, if any.
 * Always `undefined` where scope tracking is unavailable.
 */
export function currentHookOwner(): object | undefined {
  const scope = storage?.getStore();
  return scope?.active === true ? scope.owner : undefined;
}
