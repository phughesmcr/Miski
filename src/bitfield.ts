/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */

import { isUint32, Opaque } from "./utils/utils.js";

/** A Bitfield is just a Uint32Array */
export type Bitfield = Opaque<Uint32Array, "Bitfield">;

/** @param capacity The required number of bits in the bitfield */
export function bitfieldFactory(capacity: number) {
  if (!isUint32(capacity)) throw new SyntaxError("Bitfield capacity is invalid.");

  /** The array length to accommodate the required capacity */
  const size = (capacity + 31) >>> 5;

  /** An empty bitfield for use in cloning etc. */
  const EMPTY_BITFIELD = new Uint32Array(size) as Bitfield;

  /** Check if bit is valid and convert to array index */
  const getIndex = (bit: number): number => {
    if (isNaN(bit) || bit < 0 || bit > capacity) return -1;
    return bit >>> 5;
  };

  /**
   * Create a new bitfield
   * @param objs array of { id: number } type objects to pre-populate the bitfield with
   */
  const createBitfieldFromIds = <T extends { id: number }>(objs: T[]): Bitfield => {
    return objs.reduce((bitfield, { id }) => {
      const i = getIndex(id);
      if (i === -1) throw new SyntaxError(`Bitfield: bit ${id} does not exist in this world.`);
      bitfield[i] &= ~(1 << (id - i * 32));
      return bitfield;
    }, new Uint32Array(size) as Bitfield);
  };

  /** @returns `true` if a given bit is 'on' (i.e., truthy) in the Bitfield */
  const isBitOn = (bit: number, bitfield: Bitfield): boolean => {
    const i = getIndex(bit);
    if (i === -1) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this world.`);
    const cell = bitfield[i];
    if (cell === undefined) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this bitfield.`);
    return Boolean(cell & (1 << (bit - i * 32)));
  };

  /**
   * Toggle a bit in the Bitfield
   * @return the resulting state of the bit
   */
  const toggleBit = (bit: number, bitfield: Bitfield): Bitfield => {
    const i = getIndex(bit);
    if (i === -1) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this world.`);
    if (bitfield[i] === undefined) throw new SyntaxError(`Bitfield: bit ${bit} does not exist in this bitfield.`);
    bitfield[i] ^= 1 << (bit - i * 32);
    return bitfield;
  };

  return {
    EMPTY_BITFIELD,
    createBitfieldFromIds,
    isBitOn,
    toggleBit,
  };
}
