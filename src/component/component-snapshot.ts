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
    revision: number;
    lastChangedRevision: number;
    columns: Record<string, number[]>;
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
  revision: number;
  lastChangedRevision: number;
};

/** Capture a full ownership + column snapshot for rollback. */
export function captureComponentManagerSnapshot(
  states: readonly SnapshottableComponentState[],
): ComponentManagerSnapshot {
  const snapStates: Array<{
    owners?: number[];
    ownerCount: number;
    ownerList?: number[];
    revision: number;
    lastChangedRevision: number;
    columns: Record<string, number[]>;
  }> = [];
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    const instance = state.instance;
    const columns: Record<string, number[]> = {};
    if (instance.storage !== null) {
      const partitions = instance.storage.partitions as Record<string, TypedArray>;
      for (const key in partitions) {
        const partition = partitions[key]!;
        if (ArrayBuffer.isView(partition)) {
          columns[key] = Array.from(partition);
        }
      }
    }
    snapStates.push({
      owners: state.owners === undefined ? undefined : Array.from(state.owners),
      ownerCount: state.ownerCount,
      ownerList: state.ownerList === undefined ? undefined : Array.from(state.ownerList),
      revision: state.revision,
      lastChangedRevision: state.lastChangedRevision,
      columns,
    });
  }
  return { states: snapStates };
}

/** Restore a full ownership + column snapshot for rollback. */
export function restoreComponentManagerSnapshot<T extends SnapshottableComponentState>(
  states: T[],
  snapshot: ComponentManagerSnapshot,
  ensureOwnershipState: (state: T) => Uint8Array,
): void {
  for (let i = 0; i < snapshot.states.length; i++) {
    const snap = snapshot.states[i]!;
    const state = states[i]!;
    const instance = state.instance;
    if (snap.owners === undefined) {
      state.owners = undefined;
      state.ownerList = undefined;
      state.ownerPositions = undefined;
      state.ownerIterator = undefined;
      state.ownerCount = 0;
    } else {
      const owners = ensureOwnershipState(state);
      owners.set(snap.owners);
      state.ownerCount = 0;
      if (snap.ownerList !== undefined) {
        for (let j = 0; j < snap.ownerCount; j++) {
          const slot = snap.ownerList[j]!;
          state.ownerList![j] = slot;
          state.ownerPositions![slot] = j;
        }
        state.ownerCount = snap.ownerCount;
      }
    }
    state.revision = snap.revision;
    state.lastChangedRevision = snap.lastChangedRevision;
    state.changed = undefined;
    state.changedList = undefined;
    state.changedPositions = undefined;
    state.changedIterator = undefined;
    state.changedCount = 0;
    if (instance.storage !== null) {
      const partitions = instance.storage.partitions as Record<string, TypedArray>;
      for (const key in snap.columns) {
        const partition = partitions[key];
        const values = snap.columns[key]!;
        if (partition !== undefined && ArrayBuffer.isView(partition)) {
          partition.set(values);
        }
      }
    }
  }
}
