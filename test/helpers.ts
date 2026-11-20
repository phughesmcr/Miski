import type { QueryEntityList } from "../mod.ts";

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Structural equality: `Object.is` for primitives (so `NaN` equals `NaN` and `-0` differs from `0`), same prototype
 * for objects, element-wise for arrays and typed arrays, entry-wise for maps and sets, and the same own enumerable
 * keys in any order for plain objects (an `undefined` property differs from a missing one).
 */
export function equal(actual: unknown, expected: unknown, seen: Map<object, object> = new Map()): boolean {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== "object" || typeof expected !== "object" || actual === null || expected === null) return false;
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
  if (seen.get(actual) === expected) return true;
  seen.set(actual, expected);
  if (actual instanceof Date) return actual.getTime() === (expected as Date).getTime();
  if (ArrayBuffer.isView(actual)) {
    const a = actual as unknown as ArrayLike<unknown>;
    const b = expected as unknown as ArrayLike<unknown>;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (actual instanceof Map) {
    const other = expected as Map<unknown, unknown>;
    if (actual.size !== other.size) return false;
    for (const [key, value] of actual) if (!other.has(key) || !equal(value, other.get(key), seen)) return false;
    return true;
  }
  if (actual instanceof Set) {
    const other = expected as Set<unknown>;
    if (actual.size !== other.size) return false;
    for (const value of actual) if (!other.has(value)) return false;
    return true;
  }
  if (Array.isArray(actual) && actual.length !== (expected as unknown[]).length) return false;
  const a = actual as Record<string, unknown>;
  const b = expected as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !equal(a[key], b[key], seen)) return false;
  }
  return true;
}

export function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (!equal(actual, expected)) {
    throw new Error(`${message}\nExpected: ${Deno.inspect(expected)}\nActual: ${Deno.inspect(actual)}`);
  }
}

export function assertStrictEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

export function assertThrows(
  fn: () => unknown,
  ErrorClass: new (...args: never[]) => Error,
  messageIncludes: string,
): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof ErrorClass, `Expected ${ErrorClass.name}, got ${String(error)}`);
    assert(
      error instanceof Error && error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}", got "${error instanceof Error ? error.message : error}"`,
    );
    return;
  }
  throw new Error(`Expected ${ErrorClass.name} to be thrown`);
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass: new (...args: never[]) => Error,
  messageIncludes: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof ErrorClass, `Expected ${ErrorClass.name}, got ${String(error)}`);
    assert(
      error instanceof Error && error.message.includes(messageIncludes),
      `Expected error message to include "${messageIncludes}", got "${error instanceof Error ? error.message : error}"`,
    );
    return;
  }
  throw new Error(`Expected ${ErrorClass.name} to be thrown`);
}

export function ids(iterable: Iterable<number> | undefined): number[] {
  return iterable ? [...iterable] : [];
}

export function listIds(list: QueryEntityList): number[] {
  const result = new Array<number>(list.count);
  for (let i = 0; i < list.count; i++) {
    result[i] = list.entities[i]!;
  }
  return result;
}
