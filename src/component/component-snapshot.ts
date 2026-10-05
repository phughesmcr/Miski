import type { BooleanArray } from "@phughesmcr/booleanarray";

import type { EntityArray, ReusableSlotPackIterator } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { TypedArray } from "@/types/partitions.ts";

/** Full component-manager snapshot used by world rollback. */
export type ComponentManagerSnapshot = {
  readonly states: ReadonlyArray<{
    owners?: number[];
    ownerCount: number;
    ownerList?: number[];
    changedSlots: number[];
    columns: Record<string, number[]>;
    sparseColumns: Record<string, { slots: number[]; values: number[] }>;
  }>;
};

/** Snapshottable view of one component state's ownership and storage. */
export type SnapshottableComponentState = {
  readonly instance: DynamicComponentInstance;
  owners?: Uint8Array;
  ownerCount: number;
  ownerList?: EntityArray;
  ownerPositions?: EntityArray;
  ownerIterator?: ReusableSlotPackIterator;
  changed?: BooleanArray;
  changedCount: number;
  changedList?: EntityArray;
  changedPositions?: EntityArray;
  changedIterator?: ReusableSlotPackIterator;
};

type SparseColumn = TypedArray & { clearSparse(): void };

/** Capture dense columns and logical sparse mappings, including raw slot writes. */
export function captureComponentManagerSnapshot(
  states: readonly SnapshottableComponentState[],
  capacity: number,
): ComponentManagerSnapshot {
  const snapStates: ComponentManagerSnapshot["states"][number][] = [];
  for (const state of states) {
    const columns: Record<string, number[]> = Object.create(null);
    const sparseColumns: Record<string, { slots: number[]; values: number[] }> = Object.create(null);
    if (state.instance.storage !== null) {
      const partitions = state.instance.storage.partitions as Record<string, TypedArray>;
      for (const key of Object.keys(partitions)) {
        const partition = partitions[key]!;
        if (ArrayBuffer.isView(partition)) {
          columns[key] = Array.from(partition);
        } else {
          const slots: number[] = [];
          const values: number[] = [];
          for (let slot = 0; slot < capacity; slot++) {
            const value = partition[slot];
            if (value !== undefined) {
              slots.push(slot);
              values.push(value);
            }
          }
          sparseColumns[key] = { slots, values };
        }
      }
    }
    snapStates.push({
      owners: state.owners === undefined ? undefined : Array.from(state.owners),
      ownerCount: state.ownerCount,
      ownerList: state.ownerList === undefined ? undefined : Array.from(state.ownerList),
      changedSlots: state.changedList === undefined ?
        [] :
        Array.from(state.changedList.subarray(0, state.changedCount)),
      columns,
      sparseColumns,
    });
  }
  return { states: snapStates };
}

/** Restore ownership, values, and the prior changed window, issuing fresh revision tokens. */
export function restoreComponentManagerSnapshot<T extends SnapshottableComponentState>(
  states: T[],
  snapshot: ComponentManagerSnapshot,
  ensureOwnershipState: (state: T) => Uint8Array,
  ensureChangedState: (state: T) => BooleanArray | undefined,
  bumpRevision: (state: T) => void,
): void {
  for (let i = 0; i < snapshot.states.length; i++) {
    const snap = snapshot.states[i]!;
    const state = states[i]!;
    if (snap.owners === undefined) {
      state.owners = undefined;
      state.ownerList = undefined;
      state.ownerPositions = undefined;
      state.ownerIterator = undefined;
      state.ownerCount = 0;
    } else {
      const owners = ensureOwnershipState(state);
      owners.set(snap.owners);
      state.ownerList!.fill(0);
      state.ownerPositions!.fill(0);
      for (let j = 0; j < snap.ownerCount; j++) {
        const slot = snap.ownerList![j]!;
        state.ownerList![j] = slot;
        state.ownerPositions![slot] = j;
      }
      state.ownerCount = snap.ownerCount;
    }
    state.changed = undefined;
    state.changedList = undefined;
    state.changedPositions = undefined;
    state.changedIterator = undefined;
    state.changedCount = 0;
    if (snap.changedSlots.length > 0) {
      const changed = ensureChangedState(state)!;
      for (let j = 0; j < snap.changedSlots.length; j++) {
        const slot = snap.changedSlots[j]!;
        changed.set(slot, true);
        state.changedList![j] = slot;
        state.changedPositions![slot] = j;
      }
      state.changedCount = snap.changedSlots.length;
    }
    if (state.instance.storage !== null) {
      const partitions = state.instance.storage.partitions as Record<string, TypedArray>;
      for (const key of Object.keys(snap.columns)) partitions[key]!.set(snap.columns[key]!);
      // Sparse columns share their mapping; clear every column before rebuilding it.
      for (const key of Object.keys(snap.sparseColumns)) (partitions[key] as SparseColumn).clearSparse();
      for (const key of Object.keys(snap.sparseColumns)) {
        const { slots, values } = snap.sparseColumns[key]!;
        const partition = partitions[key]!;
        for (let j = 0; j < slots.length; j++) partition[slots[j]!] = values[j]!;
      }
    }
    bumpRevision(state);
  }
}
