/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */

import { isUint32, Opaque } from "./utils.js";

export type Bitfield = Opaque<Uint32Array, "Bitfield">;

/** @param capacity The required number of bits in the bitfield */
export function bitfieldFactory({ capacity }: { capacity: number }) {
  if (!isUint32(capacity)) throw new SyntaxError("Bitfield capacity is invalid.");

  /** Check if bit is valid and convert to array index */
  const getIndex = (bit: number): number => {
    if (isNaN(bit) || bit < 0 || bit > capacity) return -1;
    return bit >>> 5;
  };

  /** The array length to accommodate the required capacity */
  const size = (capacity + 31) >>> 5;

  return {
    /**
     * Create a new bitfield
     * @param existing optional existing Bitfield to clone
     */
    createBitfield: function (existing?: Bitfield): Bitfield {
      if (existing) {
        if (!(existing instanceof Uint32Array)) throw new TypeError("Existing bitfield must be a Uint32Array.");
        if (existing.length !== size) throw new SyntaxError("Existing bitfield is wrong size.");
        return existing.slice() as Bitfield;
      }
      return new Uint32Array(size) as Bitfield;
    },

    /**
     * Create a new bitfield
     * @param objs array of { id: number } type objects to prepopulate the bitfield with
     */
    createBitfieldFromIds: function <T extends { id: number }>(objs: T[]): Bitfield {
      return objs.reduce((bitfield, { id }) => {
        const i = getIndex(id);
        if (i === -1) throw new SyntaxError(`Bitfield: bit ${id} does not exist in this world.`);
        bitfield[i] &= ~(1 << (id - i * 32));
        return bitfield;
      }, new Uint32Array(size) as Bitfield);
    },

    /** @returns `true` if a given bit is 'on' (e.g., truthy) in the Bitfield */
    isBitOn: function (bit: number): (bitfield: Bitfield) => boolean {
      const i = getIndex(bit);
      if (i === -1) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this world.`);
      return function (bitfield: Bitfield): boolean {
        const cell = bitfield[i];
        if (cell === undefined) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this bitfield.`);
        return Boolean(cell & (1 << (bit - i * 32)));
      };
    },

    /** Set a bit 'off' (e.g., falsy) in the Bitfield */
    setBitOff: function (bit: number) {
      const i = getIndex(bit);
      if (i === -1) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this world.`);
      return function (bitfield: Bitfield) {
        bitfield[i] |= 1 << (bit - i * 32);
        return bitfield;
      };
    },

    /** Set a bit 'on' (e.g., truthy) in the Bitfield */
    setBitOn: function (bit: number) {
      const i = getIndex(bit);
      if (i === -1) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this world.`);
      return function (bitfield: Bitfield) {
        bitfield[i] &= ~(1 << (bit - i * 32));
        return bitfield;
      };
    },

    /**
     * Toggle a bit in the Bitfield
     * @return the resulting state of the bit
     */
    toggleBit: function (bit: number): (bitfield: Bitfield) => boolean {
      const i = getIndex(bit);
      if (i === -1) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this world.`);
      return function (bitfield: Bitfield): boolean {
        if (bitfield[i] === undefined) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this bitfield.`);
        bitfield[i] ^= 1 << (bit - i * 32);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return Boolean(bitfield[i]! & (1 << (bit - i * 32)));
      };
    },
  };
}
