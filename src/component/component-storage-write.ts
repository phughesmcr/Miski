import type { TypedArray } from "@/types/partitions.ts";
import { hasOwnProperty } from "@/utils.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";

/** Minimal storage-write view of component state (typed columns + sparse scratch). */
export type ComponentStorageWriteState = {
  readonly storageKeys: readonly string[];
  readonly storageColumns: readonly TypedArray[];
  /** Parallel scratch columns for `storageKeys` (avoids string-key lookup on write). */
  readonly coercionScratchColumns: readonly TypedArray[];
  /** One-element typed-array scratch buffers for value canonicalization. */
  coercionScratch?: Record<string, TypedArray>;
};

/**
 * Write schema columns from a data object.
 *
 * When `dataValidated` is true, values are already known finite numbers, so the write path skips
 * `hasOwnProperty` and `canonicalizeStoredValue` (TypedArray assignment performs storage coercion).
 * New ownership zeros any schema key absent from `data`.
 */
export function writeEntityStorageData(
  state: ComponentStorageWriteState,
  componentName: string,
  data: Record<string, number | undefined>,
  slot: number,
  ownershipChanged: boolean,
  dataValidated: boolean,
): void {
  const keys = state.storageKeys;
  const columns = state.storageColumns;
  if (dataValidated) {
    const keyCount = keys.length;
    // Specialize 1- and 2-field schemas (common gameplay shapes like Vec2).
    if (keyCount === 2) {
      const v0 = data[keys[0]!];
      const v1 = data[keys[1]!];
      if (v0 === undefined) {
        if (ownershipChanged) columns[0]![slot] = 0;
      } else {
        columns[0]![slot] = v0 === 0 ? 0 : v0;
      }
      if (v1 === undefined) {
        if (ownershipChanged) columns[1]![slot] = 0;
      } else {
        columns[1]![slot] = v1 === 0 ? 0 : v1;
      }
      return;
    }
    if (keyCount === 1) {
      const v0 = data[keys[0]!];
      if (v0 === undefined) {
        if (ownershipChanged) columns[0]![slot] = 0;
      } else {
        columns[0]![slot] = v0 === 0 ? 0 : v0;
      }
      return;
    }
    for (let i = 0; i < keyCount; i++) {
      const value = data[keys[i]!];
      if (value === undefined) {
        if (ownershipChanged) columns[i]![slot] = 0;
        continue;
      }
      columns[i]![slot] = value === 0 ? 0 : value;
    }
    return;
  }

  const scratchColumns = state.coercionScratchColumns;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const column = columns[i]!;
    const value = hasOwnProperty(data, key) ? data[key] : undefined;
    if (value === undefined) {
      if (ownershipChanged) column[slot] = 0;
      continue;
    }
    const scratchColumn = scratchColumns[i];
    column[slot] = scratchColumn === undefined ?
      value :
      canonicalizeStoredValue(componentName, key, value, scratchColumn);
  }
}

/**
 * Sparse / object partitions: key-walk write path when there are no dense typed columns.
 */
export function writeSparseEntityStorageData(
  partitions: Record<string, TypedArray>,
  scratch: Record<string, TypedArray>,
  componentName: string,
  data: Record<string, number | undefined>,
  slot: number,
): void {
  for (const key in data) {
    if (!hasOwnProperty(data, key)) continue;
    const value = data[key];
    if (value !== undefined && hasOwnProperty(partitions, key)) {
      const scratchColumn = scratch[key];
      partitions[key]![slot] = scratchColumn === undefined ?
        value :
        canonicalizeStoredValue(componentName, key, value, scratchColumn);
    }
  }
}
