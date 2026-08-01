import type { QueryEntityList } from "../mod.ts";

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

export function assertStrictEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

export function assertThrows(
  fn: () => unknown,
  ErrorClass: new (...args: any[]) => Error,
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
  ErrorClass: new (...args: any[]) => Error,
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
