import { BooleanArray } from "@phughesmcr/booleanarray";

/**
 * Next-fit slot allocator over an occupancy bitmap.
 *
 * `acquire` takes the first free slot at or after a rotating cursor, then moves the cursor past it. `release` leaves
 * the cursor alone, so a freed slot is only reissued once the cursor has swept round to it again. Reuse is spread over
 * every free slot instead of concentrating on the most recently freed one, which keeps a slot's 15-bit handle
 * generation from wrapping under create-then-destroy churn.
 *
 * Allocation order depends only on the occupancy bitmap and the cursor, so capturing both is enough to replay it.
 */
export class SlotAllocator {
  /** Occupancy bitmap: 1 = occupied. */
  readonly #bits: BooleanArray;

  /** Backing words of {@link #bits}. */
  readonly #words: Uint32Array;

  readonly #size: number;

  #occupiedCount: number;

  /** Slot where the next acquisition starts searching (inclusive). Always in `[0, size)`. */
  #cursor: number;

  constructor(size: number) {
    this.#bits = new BooleanArray(size);
    this.#words = this.#bits.buffer;
    this.#size = size;
    this.#occupiedCount = 0;
    this.#cursor = 0;
  }

  /** Number of slots managed. */
  get size(): number {
    return this.#size;
  }

  /** Number of occupied slots. */
  get occupiedCount(): number {
    return this.#occupiedCount;
  }

  /** Slot where the next acquisition starts searching (inclusive). */
  get cursor(): number {
    return this.#cursor;
  }

  /** @returns the acquired slot, or -1 when every slot is occupied */
  acquire(): number {
    if (this.#occupiedCount === this.#size) return -1;
    const bits = this.#bits;
    const cursor = this.#cursor;
    let slot = bits.nextFalsyIndex(cursor, this.#size);
    if (slot === -1) slot = bits.nextFalsyIndex(0, cursor);
    this.#words[slot >>> 5] = (this.#words[slot >>> 5]! | (1 << (slot & 31))) >>> 0;
    this.#occupiedCount++;
    this.#cursor = slot + 1 === this.#size ? 0 : slot + 1;
    return slot;
  }

  /** Free an occupied slot. Releasing a free slot is a no-op. Does not move the cursor. */
  release(slot: number): void {
    const word = this.#words[slot >>> 5]!;
    const mask = 1 << (slot & 31);
    if ((word & mask) === 0) return;
    this.#words[slot >>> 5] = (word & ~mask) >>> 0;
    this.#occupiedCount--;
  }

  /** @returns whether `slot` is occupied. The caller guarantees `0 <= slot < size`. */
  isOccupied(slot: number): boolean {
    return ((this.#words[slot >>> 5]! >>> (slot & 31)) & 1) === 1;
  }

  /**
   * Write occupied slots in `[startSlot, endSlot)` into `out` in ascending order.
   * @returns the number of slots written
   */
  occupiedIndicesInto(out: Uint32Array, startSlot: number = 0, endSlot: number = this.#size): number {
    const start = Math.max(startSlot, 0);
    const end = Math.min(endSlot, this.#size);
    if (start >= end) return 0;
    return this.#bits.truthyIndicesInto(out, start, end);
  }

  /** @returns a copy of the occupancy bitmap words */
  toUint32Array(): Uint32Array {
    return this.#words.slice();
  }

  /**
   * Replace occupancy and cursor in place.
   * An out-of-range cursor (including the legacy `-1` for a full pool) restarts the search at slot 0.
   */
  restore(occupancy: ArrayLike<number>, cursor: number): void {
    const words = this.#words;
    for (let i = 0; i < words.length; i++) words[i] = (occupancy[i] ?? 0) >>> 0;
    words[words.length - 1] = (words[words.length - 1]! & this.#bits.lastChunkMask) >>> 0;
    this.#occupiedCount = this.#bits.getCount(true);
    this.#cursor = Number.isInteger(cursor) && cursor >= 0 && cursor < this.#size ? cursor : 0;
  }
}
