import { ComponentDataError } from "@/errors.ts";
import type { TypedArray } from "@/types/partitions.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";

/** Storage columns and reusable canonical values shared by dense and sparse writes. */
export type ComponentStorageWriteState = {
  readonly storageKeys: readonly string[];
  readonly storageColumns: readonly TypedArray[];
  readonly coercionScratch: Record<string, TypedArray>;
  readonly coercionScratchColumns: readonly TypedArray[];
};

/** Validate every own field before membership or storage changes, staging canonical values without allocation. */
export function prepareEntityStorageData(
  state: ComponentStorageWriteState,
  componentName: string,
  data: unknown,
): void {
  if (!isObject(data)) {
    throw new TypeError(`Component data for "${componentName}" must be an object.`);
  }
  const values = data as Record<string, unknown>;
  for (const key in values) {
    if (hasOwnProperty(values, key) && state.coercionScratch[key] === undefined) {
      throw new ComponentDataError(`Component ${componentName} does not define data field "${key}".`);
    }
  }
  for (let i = 0; i < state.storageKeys.length; i++) {
    const key = state.storageKeys[i]!;
    if (!hasOwnProperty(values, key)) continue;
    const value = values[key];
    if (value === undefined) {
      throw new ComponentDataError(`Component ${componentName} data field "${key}" cannot be undefined.`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ComponentDataError(`Component ${componentName} data field "${key}" must be a finite number.`);
    }
    canonicalizeStoredValue(componentName, key, value, state.coercionScratchColumns[i]!);
  }
}

/** Commit only staged canonical values; new ownership resets absent fields to zero. */
export function writeEntityStorageData(
  state: ComponentStorageWriteState,
  data: Record<string, number | undefined>,
  slot: number,
  ownershipChanged: boolean,
): boolean {
  let changed = false;
  for (let i = 0; i < state.storageKeys.length; i++) {
    const key = state.storageKeys[i]!;
    const provided = hasOwnProperty(data, key);
    if (!provided && !ownershipChanged) continue;
    const value = provided ? state.coercionScratchColumns[i]![0]! : 0;
    const column = state.storageColumns[i]!;
    if (!Object.is(column[slot], value)) {
      column[slot] = value;
      changed = true;
    }
  }
  return changed;
}
