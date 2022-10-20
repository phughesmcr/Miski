/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */

/** */
export class Bitfield extends Uint32Array {
  /** @returns the number of set bits in a given value */
  static getSetBitCount(value: number): number {
    const a = value - ((value >> 1) & 0x55555555);
    const b = (a & 0x33333333) + ((a >> 2) & 0x33333333);
    return (((b + (b >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
  }

  /** @returns the number of set bits in a given bitfield */
  static getSetBitCountInBitfield(bitfield: Bitfield): number {
    return bitfield.reduce((res, val) => {
      if (val === 0) return res;
      return res + Bitfield.getSetBitCount(val);
    }, 0);
  }

  /**
   * Create a new Bitfield from an array of objects
   * @param size the number of bits in the bitfield
   * @param key the key of the property to use for the bitfield's indexes
   * @param objs an array of objects which have the key as an index to a number
   *
   * @example
   *  // Creating 32 bit bitfield from <T extends { id: number }>:
   *  Bitfield.fromObjects(32, "id", [{ id: 0, ... }, ...]);
   */
  static fromObjects<T>(size: number, key: keyof T, objs: T[]): Bitfield {
    return objs.reduce((bitfield, obj) => {
      bitfield.toggle(obj[key] as number);
      return bitfield;
    }, new Bitfield(size));
  }

  /** @returns the index of a bit in a bitfield */
  static indexOf(bit: number): number {
    if (isNaN(bit) || bit < 0) return -1;
    return bit >>> 5;
  }

  /**
   * Creates a new Bitfield
   * @param size the number of bits in the array
   */
  constructor(size: number) {
    super(Math.ceil(size / 32));
  }

  /** @returns The amount of bits in the array */
  get size(): number {
    return this.length << 5;
  }

  /** @returns a new Bitfield with identical properties to this Bitfield */
  clone(): Bitfield {
    const result = new Bitfield(this.size);
    result.set(this);
    return result;
  }

  /** @returns a new Bitfield based on this one with toggled bits */
  cloneWithToggle<T>(key: keyof T, sources: T[]): Bitfield {
    const bitfield = this.clone();
    // eslint-disable-next-line array-callback-return
    sources.forEach((source) => bitfield.toggle(source[key] as number));
    return bitfield;
  }

  /** @returns the index and position of a bit in the bitfield */
  getPosition(bit: number): { index: number; position: number } {
    const index = Bitfield.indexOf(bit);
    return {
      index,
      position: bit - (index << 5),
    };
  }

  /** @returns `true` if a given bit is set in the Bitfield or null on error */
  isSet(bit: number): boolean | null {
    const i = Bitfield.indexOf(bit);
    if (i === -1 || this[i] === undefined) return null;
    return !!(this[i]! & (1 << (bit - i * 32)));
  }

  /**
   * Toggle a bit in the Bitfield
   * @return the resulting state of the bit or null if error
   */
  toggle(bit: number): boolean | null {
    const i = Bitfield.indexOf(bit);
    if (i === -1) return null;
    this[i] ^= 1 << (bit - i * 32);
    return !!(this[i]! & (1 << (bit - i * 32)));
  }
}
