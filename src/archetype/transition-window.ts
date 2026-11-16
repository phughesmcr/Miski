import { createSlotArray, type EntityArray, entityIndex, type PackSlot } from "@/entity/entity.ts";
import type { Entity } from "@/entity/entity.ts";
import type { Archetype } from "./archetype.ts";

/** Rollback copy of a {@link TransitionWindow}. */
export type TransitionWindowSnapshot = {
  readonly slots: readonly number[];
  readonly origins: readonly (Archetype | undefined)[];
  readonly handles: readonly number[];
};

/**
 * Remembers which archetype every touched entity occupied when the current refresh window began.
 *
 * Query entered/exited views are window-relative: an entity entered a query when it matches now but
 * did not at window start, and exited when it matched at window start but does not now. The first
 * move of a slot in a window records its origin; later moves leave it alone. Storage is dense and
 * preallocated, so recording and clearing never allocate.
 */
export class TransitionWindow {
  readonly #packSlot: PackSlot;

  /** Archetype each touched slot occupied at window start (`undefined` = no entity then) */
  readonly #origins: Array<Archetype | undefined>;

  /** Handle that occupied each touched slot at window start */
  readonly #handles: Uint32Array;

  /** Whether a slot has been touched in the current window */
  readonly #touched: Uint8Array;

  /** Dense list of touched slots, for O(touched) clearing */
  readonly #slots: EntityArray;

  #count = 0;

  constructor(capacity: number, packSlot: PackSlot) {
    this.#packSlot = packSlot;
    this.#origins = new Array(capacity);
    this.#handles = new Uint32Array(capacity);
    this.#touched = new Uint8Array(capacity);
    this.#slots = createSlotArray(capacity);
  }

  /**
   * Record a slot's window-start archetype the first time it moves.
   * @param slot - The storage slot about to change archetype
   * @param current - The archetype the slot occupies before the change (`undefined` for a new entity)
   */
  touch(slot: number, current: Archetype | undefined): void {
    if (this.#touched[slot] === 1) return;
    this.#touched[slot] = 1;
    this.#slots[this.#count++] = slot;
    this.#origins[slot] = current;
    if (current !== undefined) this.#handles[slot] = this.#packSlot(slot);
  }

  /**
   * Get the archetype an entity occupied when the window began.
   * @returns The archetype, or `undefined` when the entity did not exist (or this handle did not own the slot)
   */
  originOf(entity: Entity): Archetype | undefined {
    const slot = entityIndex(entity);
    if (this.#touched[slot] === 0 || this.#handles[slot] !== entity) return undefined;
    return this.#origins[slot];
  }

  /** Number of slots touched in the current window. */
  get touchedCount(): number {
    return this.#count;
  }

  /** The `index`-th touched slot, in first-touch order. */
  touchedSlot(index: number): number {
    return this.#slots[index]!;
  }

  /** Archetype a touched slot occupied at window start (`undefined` = no entity then). */
  originAt(slot: number): Archetype | undefined {
    return this.#origins[slot];
  }

  /** Handle that occupied a touched slot at window start; meaningful only when {@link originAt} is defined. */
  handleAt(slot: number): Entity {
    return this.#handles[slot]! as Entity;
  }

  /** Forget every recorded origin; the next move of any slot starts a new window. */
  clear(): void {
    for (let i = 0; i < this.#count; i++) {
      const slot = this.#slots[i]!;
      this.#touched[slot] = 0;
      this.#origins[slot] = undefined;
    }
    this.#count = 0;
  }

  /** Copy the recorded origins for rollback. */
  capture(): TransitionWindowSnapshot {
    const slots: number[] = [];
    const origins: (Archetype | undefined)[] = [];
    const handles: number[] = [];
    for (let i = 0; i < this.#count; i++) {
      const slot = this.#slots[i]!;
      slots.push(slot);
      origins.push(this.#origins[slot]);
      handles.push(this.#handles[slot]!);
    }
    return { slots, origins, handles };
  }

  /** Replace the recorded origins with a captured copy. */
  restore(snapshot: TransitionWindowSnapshot): void {
    this.clear();
    for (let i = 0; i < snapshot.slots.length; i++) {
      const slot = snapshot.slots[i]!;
      this.#touched[slot] = 1;
      this.#slots[this.#count++] = slot;
      this.#origins[slot] = snapshot.origins[i];
      this.#handles[slot] = snapshot.handles[i]!;
    }
  }
}
