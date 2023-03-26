/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { LOG_2, NO_INDEX } from "./constants.js";

/**
 * Count the number of set bits in a 32-bit integer ("population count").
 * @returns the number of set bits in a given value
 * @see https://graphics.stanford.edu/~seander/bithacks.html
 * @license public-domain
 */
export const getPopulationCount = (value: number): number => {
  const a = value - ((value >> 1) & 0x55555555);
  const b = (a & 0x33333333) + ((a >> 2) & 0x33333333);
  return (((b + (b >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
};

export const getLowestSetBit = (value: number) => value & -value;

export const getLowestSetPosition = (value: number) => LOG_2[getLowestSetBit(value)] ?? NO_INDEX;

export const intersectBits = (a = 0, b = 0): number => a & b;
