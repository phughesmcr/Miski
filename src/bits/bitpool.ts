/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import type { Bitfield } from "./bitfield.js";
import * as bitfield from "./bitfield.js";
import { NO_INDEX } from "./constants.js";
import { getLowestSetIndex } from "./utils.js";

export type Bitpool = {
  /** A bitfield, where each bit represents a free index in the bitpool */
  field: Bitfield;
  /** The next available index in the bitpool */
  nextAvailableIdx: number;
  /** The size of the bitpool */
  size: number;
};

/**
 * Creates a new BitPool with the specified size.
 * @param size The number of bits in the BitPool.
 * @returns A new BitPool instance.
 * @throws {SyntaxError} if `size` is <= 0
 * @throws {TypeError} if `size` is NaN
 */
export const create = (size: number): Bitpool => {
  const field = bitfield.create(size);
  field.fill(0xffffffff);
  return {
    field,
    nextAvailableIdx: 0,
    size,
  };
};

/**
 * Gets the population count (the number of set bits) in the BitPool.
 * @param bitpool The BitPool instance.
 * @returns The population count.
 */
export const getPopulationCount = ({ field }: Bitpool) => bitfield.getPopulationCount(field);

/** @returns The maximum amount of bits in the array */
export const getSize = ({ size }: Bitpool) => size << 5;

/**
 * Acquires an available bit in the BitPool, setting it to '0'.
 * @param bitpool The BitPool instance.
 * @returns The acquired bit's position or -1 if no bits are available.
 */
export const acquire = (bitpool: Bitpool) => {
  const { nextAvailableIdx } = bitpool;
  if (!~nextAvailableIdx) return NO_INDEX;
  const index = bitpool.field[nextAvailableIdx] as number;
  const position = getLowestSetIndex(index);
  if (position >= bitpool.size) return NO_INDEX;
  bitpool.field[nextAvailableIdx] &= ~(1 << position);
  if (bitpool.field[nextAvailableIdx] === 0) {
    bitpool.nextAvailableIdx = NO_INDEX;
    for (let i = 0; i < bitpool.field.length; i++) {
      if (bitpool.field[i] !== 0) {
        bitpool.nextAvailableIdx = i;
        break;
      }
    }
  }
  return (nextAvailableIdx << 5) + position;
};

/**
 * Releases a bit in the Bitpool, setting it back to '1'.
 * @param bitpool The Bitpool instance.
 * @param value The position of the bit to release.
 * @returns The updated Bitpool instance.
 */
export const release = (bitpool: Bitpool, value: number): Bitpool => {
  const { index, position } = bitfield.getPosition(value);
  if (index === NO_INDEX || position >= bitpool.size) return bitpool;
  bitpool.field[index] |= 1 << position;
  bitpool.nextAvailableIdx = index;
  return bitpool;
};
