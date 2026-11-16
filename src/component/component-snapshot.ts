import type { BooleanArray } from "@phughesmcr/booleanarray";

import type { EntityArray } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";

/** One component's rollback state: owned rows only, in owner-iteration order. */
type ComponentStateSnapshot = {
  /** Owner slots in iteration order. */
  readonly owners: EntityArray;
  /** Changed slots in iteration order (always a subset of `owners`). */
  readonly changed: EntityArray;
  /** Owned row values per storage column (parallel to `storageColumns`), each parallel to `owners`. */
  readonly rows: readonly TypedArray[];
};

/** Component-manager snapshot used by world rollback. */
export type ComponentManagerSnapshot = {
  readonly states: readonly ComponentStateSnapshot[];
};

/** Snapshottable view of one component state's ownership and storage. */
export type SnapshottableComponentState = {
  readonly instance: DynamicComponentInstance;
  readonly storageColumns: readonly TypedArray[];
  readonly usesSparseStorage: boolean;
  owners?: Uint8Array;
  ownerCount: number;
  ownerList?: EntityArray;
  ownerPositions?: EntityArray;
  changed?: BooleanArray;
  changedCount: number;
  changedList?: EntityArray;
  changedPositions?: EntityArray;
};

/** Component-manager callbacks used to rebuild tracking state during restore. */
export type ComponentSnapshotRestoreHooks<T extends SnapshottableComponentState> = {
  /** Allocate ownership tracking (if needed) and return the owner flags. */
  readonly ensureOwnershipState: (state: T) => Uint8Array;
  /** Allocate changed tracking (if needed) and return the changed flags. */
  readonly ensureChangedState: (state: T) => BooleanArray | undefined;
  /** Map a capped component's dense row for an owned slot, reclaiming non-owner rows if exhausted. */
  readonly reserveSparseSlot: (state: T, owners: Uint8Array, slot: number) => void;
  /** Issue fresh revision tokens. */
  readonly bumpRevision: (state: T) => void;
};

type SparseColumn = TypedArray & {
  readonly dense: TypedArray;
  getEntity(entity: number): number | undefined;
  setEntity(entity: number, value: number): void;
  deleteEntity(entity: number): boolean;
};

const EMPTY_SLOTS: EntityArray = new Uint8Array(0);

function copyPrefix(list: EntityArray | undefined, count: number): EntityArray {
  return list === undefined || count === 0 ? EMPTY_SLOTS : list.slice(0, count);
}

/**
 * Capture ownership, the changed window, and the values of owned rows.
 *
 * Cost scales with owner count, not world capacity. Raw writes to non-owner slots are an unguarded escape hatch and
 * are not part of the snapshot: every acquisition re-initializes its row, so non-owner cells are never observable
 * through ownership-checked APIs.
 */
export function captureComponentManagerSnapshot(
  states: readonly SnapshottableComponentState[],
): ComponentManagerSnapshot {
  const snapStates: ComponentStateSnapshot[] = new Array(states.length);
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    const count = state.ownerCount;
    const owners = copyPrefix(state.ownerList, count);
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
    snapStates[i] = { owners, changed: copyPrefix(state.changedList, state.changedCount), rows };
  }
  return { states: snapStates };
}

/**
 * Restore ownership (in iteration order), owned values, and the prior changed window, issuing fresh revision tokens.
 * Existing tracking arrays are cleared and reused; only current and captured members are touched.
 */
export function restoreComponentManagerSnapshot<T extends SnapshottableComponentState>(
  states: readonly T[],
  snapshot: ComponentManagerSnapshot,
  hooks: ComponentSnapshotRestoreHooks<T>,
): void {
  for (let i = 0; i < snapshot.states.length; i++) {
    const snap = snapshot.states[i]!;
    const state = states[i]!;
    const columns = state.storageColumns;
    const sparse = state.usesSparseStorage ? columns[0] as SparseColumn : undefined;

    // Retire current membership. Unmapping current owners' sparse rows (the index is shared by every column)
    // frees rows for the captured owners.
    const currentOwners = state.owners;
    if (currentOwners !== undefined) {
      const list = state.ownerList!;
      for (let j = 0; j < state.ownerCount; j++) {
        const slot = list[j]!;
        currentOwners[slot] = 0;
        sparse?.deleteEntity(slot);
      }
    }
    state.ownerCount = 0;
    const currentChanged = state.changed;
    if (currentChanged !== undefined) {
      const list = state.changedList!;
      for (let j = 0; j < state.changedCount; j++) currentChanged.set(list[j]!, false);
    }
    state.changedCount = 0;

    const ownerSlots = snap.owners;
    const ownerCount = ownerSlots.length;
    if (ownerCount > 0) {
      const owners = hooks.ensureOwnershipState(state);
      const list = state.ownerList!;
      const positions = state.ownerPositions!;
      for (let j = 0; j < ownerCount; j++) {
        const slot = ownerSlots[j]!;
        owners[slot] = 1;
        list[j] = slot;
        positions[slot] = j;
      }
      state.ownerCount = ownerCount;
      if (sparse !== undefined) {
        for (let j = 0; j < ownerCount; j++) hooks.reserveSparseSlot(state, owners, ownerSlots[j]!);
      }
    }

    const changedSlots = snap.changed;
    const changedCount = changedSlots.length;
    if (changedCount > 0) {
      const changed = hooks.ensureChangedState(state)!;
      const list = state.changedList!;
      const positions = state.changedPositions!;
      for (let j = 0; j < changedCount; j++) {
        const slot = changedSlots[j]!;
        changed.set(slot, true);
        list[j] = slot;
        positions[slot] = j;
      }
      state.changedCount = changedCount;
    }

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
    hooks.bumpRevision(state);
  }
}
