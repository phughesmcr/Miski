/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */

/** */
export class Bitfield extends Uint32Array {
  /**
   * Create a new Bitfield from an array of objects
   * @param objs an array of objects which have an id number property
   */
  static fromIds<T extends { id: number }>(length: number, objs: T[]): Bitfield {
    return objs.reduce((bitfield, { id }) => {
      const i = Bitfield.indexOf(id);
      if (i !== -1) bitfield[i] ^= 1 << (id - i * 32);
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

  /** @returns a new Bitfield with identical properties to this Bitfield */
  clone(): Bitfield {
    return new Bitfield(this);
  }

  /** @returns a new Bitfield based on this one with toggled bits */
  cloneWithToggle<T extends { id: number }>(sources: T[]): Bitfield {
    const bitfield = this.clone();
    sources.forEach(({ id }) => bitfield.toggle(id));
    return bitfield;
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
   */
  toggle(bit: number): boolean {
    const i = Bitfield.indexOf(bit);
    if (i === -1) throw new SyntaxError(`Bitfield.indexOf(${bit}) returned -1.`);
    if (this[i] === undefined) this[i] = 0;
    this[i] ^= 1 << (bit - i * 32);
    return Boolean(this[i]! & (1 << (bit - i * 32)));
  }
}
