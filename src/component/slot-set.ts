import { createSlotArray, type EntityArray, type PackSlot, ReusableSlotPackIterator } from "@/entity/entity.ts";

/** Initial length of a set's dense list; it doubles on demand up to the set's maximum length. */
const INITIAL_LIST_LENGTH = 16;

/**
 * A sparse set of storage slots: a dense member list in insertion order plus a slot -> position index.
 *
 * Nothing capacity-sized is allocated until the first {@link reserve} (or {@link add}); the list starts at 16 entries
 * and doubles up to `maxLength`. Entries at or past {@link count} are stale and never read. `add` and `remove` do not
 * check membership, and `add` does not check `maxLength`; callers check {@link has} (or their own flags) and their
 * cap first.
 * @internal
 */
export class SlotSet {
  /** Members in iteration order; only the first {@link count} entries are live. */
  list: EntityArray;
  /** Slot -> index in {@link list}; meaningful only for members. Empty until the first reservation. */
  positions: EntityArray;
  /** Number of members. */
  count: number;
  /** Reusable iterator over the members, packing each slot into an entity handle. */
  readonly iterator: ReusableSlotPackIterator;
  /** World capacity: the slot range and the `positions` length. */
  readonly #capacity: number;
  /** Most members the set can ever hold. */
  readonly #maxLength: number;

  /**
   * @param capacity - World capacity (slots are `0 <= slot < capacity`)
   * @param maxLength - Most members the set can hold (at most `capacity`)
   * @param packSlot - Packs a live slot into an entity handle for {@link iterator}
   */
  constructor(capacity: number, maxLength: number, packSlot: PackSlot) {
    this.#capacity = capacity;
    this.#maxLength = maxLength;
    // Zero-length arrays of the world's slot-array type keep `list` / `positions` monomorphic once allocated.
    this.list = createSlotArray(capacity, 0);
    this.positions = this.list;
    this.count = 0;
    this.iterator = new ReusableSlotPackIterator(this.list, packSlot);
  }

  /** Make room for at least `minLength` members: allocate on first use, then double (capped at the maximum). */
  reserve(minLength: number): void {
    if (this.positions.length === 0) this.positions = createSlotArray(this.#capacity);
    const current = this.list;
    if (current.length >= minLength) return;
    const length = current.length === 0 ? INITIAL_LIST_LENGTH : current.length * 2;
    const list = createSlotArray(this.#capacity, Math.min(Math.max(length, minLength), this.#maxLength));
    list.set(current);
    this.list = list;
    this.iterator.slots = list;
  }

  /** `true` if `slot` is a member. */
  has(slot: number): boolean {
    if (this.count === 0) return false;
    const position = this.positions[slot]!;
    return position < this.count && this.list[position] === slot;
  }

  /** Append a slot that is not a member. */
  add(slot: number): void {
    const count = this.count;
    if (count === this.list.length) this.reserve(count + 1);
    this.list[count] = slot;
    this.positions[slot] = count;
    this.count = count + 1;
  }

  /** Remove a member by moving the last member into its place. */
  remove(slot: number): void {
    const list = this.list;
    const positions = this.positions;
    const removeIndex = positions[slot]!;
    const lastIndex = this.count - 1;
    if (removeIndex !== lastIndex) {
      const lastSlot = list[lastIndex]!;
      list[removeIndex] = lastSlot;
      positions[lastSlot] = removeIndex;
    }
    this.count = lastIndex;
  }

  /** Replace the members with `slots`, in order. `slots` must not repeat a slot. */
  assign(slots: ArrayLike<number>): void {
    const length = slots.length;
    this.count = 0;
    if (length === 0) return;
    this.reserve(length);
    const list = this.list;
    const positions = this.positions;
    for (let i = 0; i < length; i++) {
      const slot = slots[i]!;
      list[i] = slot;
      positions[slot] = i;
    }
    this.count = length;
  }

  /** Remove every member. The arrays are kept for reuse. */
  clear(): void {
    this.count = 0;
  }
}
