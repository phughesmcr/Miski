/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { LOG_2 } from "../constants.js";

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */

/** */
export class Bitfield extends Uint32Array {
  static get [Symbol.species](): Uint32ArrayConstructor {
    return Uint32Array;
  }

  /** @returns the index of the least significant bit or -1 if error */
  static getLsbIndex(value: number): number {
    if (value === 2147483648) return 31;
    return LOG_2[value & -value] ?? -1;
  }

  /** @returns the number of set bits in a given number */
  static getSetBitCount(value: number): number {
    const a = value - ((value >> 1) & 0x55555555);
    const b = (a & 0x33333333) + ((a >> 2) & 0x33333333);
    return (((b + (b >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
  }

  /**
   * Create a new Bitfield from an array of objects
   * @param length the number of bits in the bitfield
   * @param key the key of the property to use for the bitfield's indexes
   * @param objs an array of objects which have the key as an index to a number
   *
   * @example
   * // Creating 32 bit bitfield from <T extends { id: number }>:
   * Bitfield.fromObjects(32, "id", [{ id: 0, ... }, ...]);
   */
  static fromObjects<T>(length: number, key: keyof T, objs: T[]): Bitfield {
    return objs.reduce((bitfield, obj) => {
      const id = obj[key] as number;
      if (isNaN(id as number)) return bitfield;
      const i = Bitfield.indexOf(id);
      if (i > -1) bitfield[i] ^= 1 << (id  - i * 32);
      return bitfield;
    }, new Bitfield(length));
  }

  /** @returns the index of a bit in the bitfield */
  static indexOf(bit: number): number {
    if (isNaN(bit) || bit < 0) return -1;
    return bit >>> 5;
  }

  /** @returns the intersection of two bits */
  static intersectBits(a = 0, b = 0): number {
    return a & b;
  }

  /**
   * Creates a new Bitfield
   * @param length the number of bits in the array
   */
  constructor(length: number) {
    super(Math.ceil(length / 32));
  }

  /** @returns The amount of bits in the array */
  get size(): number {
    return this.length << 5;
  }

  /** @returns a new Bitfield with identical properties to this Bitfield */
  clone(): Bitfield {
    const result = new Bitfield(this.length);
    result.set(this);
    return result;
  }

  /** @returns a new Bitfield based on this one with toggled bits */
  cloneWithToggle<T>(key: keyof T, sources: T[]): Bitfield {
    const bitfield = this.clone();
    sources.forEach((source) => bitfield.toggle(source[key] as number));
    return bitfield;
  }

  /** @returns the index and position of a bit in the bitfield */
  getPosition(bit: number): { index: number, position: number } {
    const index = Bitfield.indexOf(bit);
    return {
      index,
      position: bit - (index << 5),
    }
  }

  /** @returns `true` if a given bit is 'on' (i.e., truthy) in the Bitfield */
  isOn(bit: number): boolean {
    const i = Bitfield.indexOf(bit);
    if (i === -1 || this[i] === undefined) return false;
    return Boolean(this[i]! & (1 << (bit - i * 32)));
  }

  /**
   * Toggle a bit in the Bitfield
   * @return the resulting state of the bit
   * @throws if the bit is not found (i.e., indexOf(bit) === -1)
   */
  toggle(bit: number): boolean {
    const i = Bitfield.indexOf(bit);
    if (i === -1) throw new SyntaxError(`Bitfield.indexOf(${bit}) returned -1.`);
    if (this[i] === undefined) this[i] = 0;
    this[i] ^= 1 << (bit - i * 32);
    return !!(this[i]! & (1 << (bit - i * 32)));
  }
}
