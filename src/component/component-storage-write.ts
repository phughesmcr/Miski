import { ComponentDataError } from "@/errors.ts";
import { hasOwnProperty, isObject } from "@/utils.ts";
import { canonicalizeStoredValue } from "@/value/canonicalize.ts";
import type { ComponentState } from "./component-state.ts";
import { encodeFieldValue, validateSideValue } from "./field-codec.ts";

/** The parts of a component's state that validation and storage writes read. */
export type ComponentStorageWriteState = Pick<
  ComponentState,
  | "storageKeys"
  | "storageColumns"
  | "coercionScratch"
  | "coercionScratchColumns"
  | "storageCodecs"
  | "storageDefaults"
  | "sideKeys"
  | "sideColumns"
  | "sideFields"
  | "sideIndex"
  | "sideScratch"
  | "sideInitial"
  | "isEntityActive"
>;

/** Validate every own field before membership or storage changes, staging raw values without allocation. */
export function prepareEntityStorageData(
  state: ComponentStorageWriteState,
  componentName: string,
  data: unknown,
): void {
  if (!isObject(data)) {
    throw new ComponentDataError(`Component data for "${componentName}" must be an object.`);
  }
  const values = data as Record<string, unknown>;
  for (const key in values) {
    if (
      hasOwnProperty(values, key) && state.coercionScratch[key] === undefined && state.sideIndex[key] === undefined
    ) {
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
    const codec = state.storageCodecs[i]!;
    if (codec !== null) {
      state.coercionScratchColumns[i]![0] = encodeFieldValue(codec, componentName, key, value, state.isEntityActive);
      continue;
    }
    canonicalizeStoredValue(componentName, key, value as number, state.coercionScratchColumns[i]!);
  }
  for (let i = 0; i < state.sideKeys.length; i++) {
    const key = state.sideKeys[i]!;
    if (!hasOwnProperty(values, key)) continue;
    const value = values[key];
    validateSideValue(state.sideFields[i]!, componentName, key, value);
    state.sideScratch[i] = value;
  }
}

/** Commit only staged values; new ownership resets absent fields to their defaults. */
export function writeEntityStorageData(
  state: ComponentStorageWriteState,
  data: Record<string, unknown>,
  slot: number,
  ownershipChanged: boolean,
): boolean {
  let changed = false;
  for (let i = 0; i < state.storageKeys.length; i++) {
    const key = state.storageKeys[i]!;
    const provided = hasOwnProperty(data, key);
    if (!provided && !ownershipChanged) continue;
    const value = provided ? state.coercionScratchColumns[i]![0]! : state.storageDefaults[i]!;
    const column = state.storageColumns[i]!;
    if (!Object.is(column[slot], value)) {
      column[slot] = value;
      changed = true;
    }
  }
  for (let i = 0; i < state.sideKeys.length; i++) {
    const provided = hasOwnProperty(data, state.sideKeys[i]!);
    if (!provided && !ownershipChanged) continue;
    const value = provided ? state.sideScratch[i] : state.sideInitial[i];
    const column = state.sideColumns[i]!;
    if (!Object.is(column[slot], value)) {
      column[slot] = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Commit a full row for a new owner: staged canonical values for the fields `data` provides, `row` defaults for
 * the rest. `row` is parallel to `storageKeys` and already canonical; each cell is copied as-is, whatever its type.
 * Side fields take their staged value or the new owner's staged initial value.
 */
export function writeEntityStorageRow(
  state: ComponentStorageWriteState,
  row: ArrayLike<unknown>,
  data: Record<string, unknown> | undefined,
  slot: number,
): void {
  const keys = state.storageKeys;
  const columns = state.storageColumns as unknown as { [slot: number]: unknown }[];
  for (let i = 0; i < keys.length; i++) {
    columns[i]![slot] = data !== undefined && hasOwnProperty(data, keys[i]!) ?
      state.coercionScratchColumns[i]![0] :
      row[i];
  }
  const sideKeys = state.sideKeys;
  const sideColumns = state.sideColumns;
  for (let i = 0; i < sideKeys.length; i++) {
    sideColumns[i]![slot] = data !== undefined && hasOwnProperty(data, sideKeys[i]!) ?
      state.sideScratch[i] :
      state.sideInitial[i];
  }
}
