/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { BITS_PER_INT, NO_INDEX } from "./constants.js";
import { getPopulationCount as popcnt } from "./utils.js";

/**
 *
 */
export type Bitfield = Uint32Array;

/**
 * @returns The amount of bits in the array
 */
export const getSize = (field: Bitfield) => field.length << 5;

/**
 * @returns the index of a bit in a bitfield, -1 if not found
 */
export const indexOf = (bit: number): number => {
  if (isNaN(bit)) throw new TypeError(`Expected a number, found "${typeof bit}"`);
  if (bit < 0) return NO_INDEX;
  return bit >>> 5;
};

/**
 * Toggle a bit in the Bitfield
 * @return the resulting state of the bit
 */
export const toggle = (field: Bitfield, bit: number): boolean => {
  const i = indexOf(bit);
  if (i === NO_INDEX) throw new RangeError(`Bit ${bit} does not exist in the bitfield.`);
  const value = 1 << (bit - i * BITS_PER_INT);
  field[i] ^= value;
  return !!(field[i]! & (1 << value));
};

/**
 * Creates a new Bitfield
 * @param size the number of bits in the array
 */
export const create = (size: number): Bitfield => {
  return new Uint32Array(Math.ceil(size / BITS_PER_INT));
};

/**
 *
 * @returns a new Bitfield with identical properties to this Bitfield
 */
export const clone = (field: Bitfield): Bitfield => {
  const size = getSize(field);
  const result = create(size);
  result.set(field);
  return result;
};

/**
 * @returns a new Bitfield based on this one with toggled bits
 */
export const cloneWithToggle = <T>(field: Bitfield, key: keyof T, sources: T[]): Bitfield => {
  const res = clone(field);
  const visited: Set<number> = new Set();
  for (const source of sources) {
    const value = source[key] as number;
    if (visited.has(value)) continue;
    toggle(res, value);
    visited.add(value);
  }
  return res;
};

/**
 * Create a new Bitfield from an array of objects
 * @param size the number of bits in the bitfield
 * @param key the key of the property to use for the bitfield's indexes
 * @param objs an array of objects which have the key as an index to a number
 *
 * @example
 *  // Creating 43 bit bitfield from <T extends { id: number }>:
 *  Bitfield.fromObjects(43, "id", [{ id: 0, ... }, ...]);
 */
export const fromObjects = <T>(size: number, key: keyof T, objs: T[]): Bitfield => {
  const res = create(size);
  const visited: Set<number> = new Set();
  for (const obj of objs) {
    const value = obj[key] as number;
    if (visited.has(value)) continue;
    toggle(res, value);
    visited.add(value);
  }
  return res;
};

/**
 * @returns the number of set bits in a given bitfield
 */
export const getPopulationCount = (field: Bitfield): number =>
  field.reduce((res, val) => {
    if (!val) return res;
    return res + popcnt(val);
  }, 0);

/**
 * @returns the index and position of a bit in the bitfield
 */
export const getPosition = (bit: number): { index: number; position: number } => ({
  index: indexOf(bit),
  position: bit & 31,
});

/**
 * @returns `true` if a given bit is set in the Bitfield
 */
export const isSet = (field: Bitfield, bit: number): boolean => {
  const idx = indexOf(bit);
  if (idx === NO_INDEX) throw new RangeError(`Bit ${bit} does not exist in the bitfield.`);
  return !!(field[idx]! & (1 << (bit - idx * BITS_PER_INT)));
};
