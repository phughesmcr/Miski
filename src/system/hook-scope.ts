/**
 * Detection of code running inside a system lifecycle hook (`init` / `destroy`).
 *
 * A hook that awaits world readiness or teardown waits on itself: readiness and teardown both wait for the
 * pending hook. Where the runtime provides `AsyncLocalStorage` (Deno, Node, Bun) the async continuation of a
 * pending hook is tracked, so such calls can be rejected deterministically. Runtimes without it (e.g. browsers)
 * fall back to the teardown signal in the world, which rejects waiting `onReady` calls once teardown starts.
 */

type HookScope = { active: boolean };

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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as PromiseLike<unknown>).then === "function";
}

/**
 * Run a lifecycle hook, marking it and its asynchronous continuations as hook code until it settles.
 * Where scope tracking is unavailable the hook simply runs.
 */
export function runInHookScope<T>(fn: () => T): T {
  if (storage === undefined) return fn();
  const scope: HookScope = { active: true };
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
