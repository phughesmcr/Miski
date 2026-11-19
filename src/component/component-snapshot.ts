import type { EntityArray } from "@/entity/entity.ts";
import type { TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";
import type { ComponentState, SparseColumn } from "./component-state.ts";
import { sideDefault } from "./field-codec.ts";
import type { SlotSet } from "./slot-set.ts";

/** One component's owned state, in owner-iteration order: a rollback snapshot, and a component in a world save. */
export type ComponentStateSnapshot = {
  /** Owner slots in iteration order. */
  readonly owners: EntityArray;
  /** Changed slots in iteration order (always a subset of `owners`). */
  readonly changed: EntityArray;
  /** Owned row values per storage column (parallel to `storageColumns`), each parallel to `owners`. */
  readonly rows: readonly TypedArray[];
  /**
   * Owned string / object values per side column (parallel to `sideColumns`), each parallel to `owners`. In a world
   * save's image, object columns hold encoded values (`string`, `number` or `null`); only the copy a load restores
   * from holds decoded values.
   */
  readonly sideRows: readonly (readonly unknown[])[];
};

/** Component-manager snapshot used by world rollback. */
export type ComponentManagerSnapshot = {
  readonly states: readonly ComponentStateSnapshot[];
};

/** Component-manager callbacks used to rebuild tracking state during restore. */
export type ComponentSnapshotRestoreHooks = {
  /** The owner flags, allocated on first use. */
  readonly ownerFlags: (state: ComponentState) => Uint8Array;
  /** Map a capped component's dense row for an owned slot, reclaiming non-owner rows if exhausted. */
  readonly reserveSparseSlot: (state: ComponentState, flags: Uint8Array, slot: number) => void;
  /** Issue fresh revision tokens. */
  readonly bumpRevision: (state: ComponentState) => void;
};

const EMPTY_SLOTS: EntityArray = new Uint8Array(0);

/** Shared side rows for components without string / object fields. */
const EMPTY_SIDE_ROWS: readonly (readonly unknown[])[] = Object.freeze([]);

function copyMembers(set: SlotSet): EntityArray {
  return set.count === 0 ? EMPTY_SLOTS : set.list.slice(0, set.count);
}

/**
 * Capture ownership, the changed window, and the values of owned rows.
 *
 * Cost scales with owner count, not world capacity. Raw writes to non-owner slots are an unguarded escape hatch and
 * are not part of the snapshot: every acquisition re-initializes its row, so non-owner cells are never observable
 * through ownership-checked APIs.
 */
export function captureComponentManagerSnapshot(
  states: readonly ComponentState[],
): ComponentManagerSnapshot {
  const snapStates: ComponentStateSnapshot[] = new Array(states.length);
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    const owners = copyMembers(state.owners);
    const count = owners.length;
    const columns = state.storageColumns;
    const rows: TypedArray[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c]!;
      if (ArrayBuffer.isView(column)) {
        const values = new (column.constructor as TypedArrayConstructor)(count);
        for (let j = 0; j < count; j++) values[j] = column[owners[j]!]!;
        rows[c] = values;
      } else {
        const sparse = column as SparseColumn;
        const values = new (sparse.dense.constructor as TypedArrayConstructor)(count);
        const getEntity = sparse.getEntity;
        for (let j = 0; j < count; j++) values[j] = getEntity(owners[j]!)!;
        rows[c] = values;
      }
    }
    const sideColumns = state.sideColumns;
    let sideRows = EMPTY_SIDE_ROWS;
    if (sideColumns.length > 0) {
      const captured: unknown[][] = new Array(sideColumns.length);
      for (let c = 0; c < sideColumns.length; c++) {
        const column = sideColumns[c]!;
        const property = state.sideFields[c]!;
        const values = new Array<unknown>(count);
        // Objects with a clone hook are copied once here; restore installs the copies, since a point restores once.
        // Resolve the hook per column (as `cloneFieldValue` would per cell), then copy without re-checking.
        const clone = property.kind === "object" ? property.clone : undefined;
        if (clone === undefined) {
          for (let j = 0; j < count; j++) values[j] = column[owners[j]!];
        } else {
          for (let j = 0; j < count; j++) {
            const value = column[owners[j]!];
            values[j] = value === null ? value : clone(value);
          }
        }
        captured[c] = values;
      }
      sideRows = captured;
    }
    snapStates[i] = { owners, changed: copyMembers(state.changed), rows, sideRows };
  }
  return { states: snapStates };
}

/**
 * Restore ownership (in iteration order), owned values, and the prior changed window, issuing fresh revision tokens.
 * Existing tracking arrays are cleared and reused; only current and captured members are touched.
 */
export function restoreComponentManagerSnapshot(
  states: readonly ComponentState[],
  snapshot: ComponentManagerSnapshot,
  hooks: ComponentSnapshotRestoreHooks,
): void {
  for (let i = 0; i < snapshot.states.length; i++) {
    const snap = snapshot.states[i]!;
    const state = states[i]!;
    const columns = state.storageColumns;
    const sparse = state.usesSparseStorage ? columns[0] as SparseColumn : undefined;

    // Retire current membership. Unmapping current owners' sparse rows (the index is shared by every column)
    // frees rows for the captured owners.
    const currentFlags = state.ownerFlags;
    const sideColumns = state.sideColumns;
    const owners = state.owners;
    if (currentFlags !== null) {
      const list = owners.list;
      for (let j = 0; j < owners.count; j++) {
        const slot = list[j]!;
        currentFlags[slot] = 0;
        sparse?.deleteEntity(slot);
      }
      // Release current owners' string / object references; captured owners are rewritten below.
      for (let c = 0; c < sideColumns.length; c++) {
        const column = sideColumns[c]!;
        const empty = sideDefault(state.sideFields[c]!);
        for (let j = 0; j < owners.count; j++) column[list[j]!] = empty;
      }
    }

    const ownerSlots = snap.owners;
    const ownerCount = ownerSlots.length;
    owners.assign(ownerSlots);
    if (ownerCount > 0) {
      const flags = hooks.ownerFlags(state);
      for (let j = 0; j < ownerCount; j++) flags[ownerSlots[j]!] = 1;
      if (sparse !== undefined) {
        for (let j = 0; j < ownerCount; j++) hooks.reserveSparseSlot(state, flags, ownerSlots[j]!);
      }
    }
    // The changed window is a sparse set: assigning rewrites only the captured members.
    state.changed.assign(snap.changed);

    for (let c = 0; c < columns.length; c++) {
      const column = columns[c]!;
      const values = snap.rows[c]!;
      if (sparse === undefined) {
        for (let j = 0; j < ownerCount; j++) column[ownerSlots[j]!] = values[j]!;
      } else {
        const setEntity = (column as SparseColumn).setEntity;
        for (let j = 0; j < ownerCount; j++) setEntity(ownerSlots[j]!, values[j]!);
      }
    }
    for (let c = 0; c < sideColumns.length; c++) {
      const column = sideColumns[c]!;
      const values = snap.sideRows[c]!;
      for (let j = 0; j < ownerCount; j++) column[ownerSlots[j]!] = values[j];
    }
    hooks.bumpRevision(state);
  }
}
