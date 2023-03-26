/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

import { BITS_PER_INT, NO_INDEX } from "./constants.js";
import { getPopulationCount as popcnt } from "./utils.js";

/** A little-endian bitfield backed by a Uint32Array */
export type Bitfield = Uint32Array;

/**
 * @returns the number of bits in the bitfield.
 * @param field The bitfield to get the size of.
 */
export const getSize = (field: Bitfield) => field.length << 5;

/**
 * @returns the index of a bit in a bitfield, or -1 if invalid
 * @param bit the bit to get the index of
 * @throws {TypeError} if `bit` is NaN
 */
export const indexOf = (bit: number): number => {
  if (isNaN(bit)) throw new TypeError(`Expected a number, found "${typeof bit}"`);
  if (bit < 0) return NO_INDEX;
  return bit >>> 5;
};

/**
 * Toggle the state of a bit in a Bitfield
 * @param field the bitfield in which the bit resides
 * @param bit the bit to check
 * @return the resulting state of the bit
 * @throws {RangeError} if `bit` is not found
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
 * @throws {SyntaxError} if `size` is <= 0
 * @throws {TypeError} if `size` is NaN
 */
export const create = (size: number): Bitfield => {
  if (isNaN(size)) throw new TypeError(`Expected "size" to be a number, found "${typeof size}".`);
  if (size <= 0) throw new SyntaxError(`"size" must be > 0, found ${size.toString()}.`);
  return new Uint32Array(Math.ceil(size / BITS_PER_INT));
};

/**
 * Create a new copy of a bitfield.
 * @param field the bitfield to clone
 * @returns the new clone bitfield
 */
export const clone = (field: Bitfield): Bitfield => {
  const size = getSize(field);
  const result = create(size);
  result.set(field);
  return result;
};

/**
 * @returns a new Bitfield based on this one with toggled bits
 * @throws {RangeError} if a value is not found in the bitfield
 */
export const cloneWithToggle = <T>(field: Bitfield, key: keyof T, sources: T[]): Bitfield => {
  const result = clone(field);
  const visited: Set<number> = new Set();
  for (const source of sources) {
    const value = source[key] as number;
    if (visited.has(value)) continue;
    toggle(result, value);
    visited.add(value);
  }
  return result;
};

/**
 * Create a new Bitfield from an array of objects
 * @param size the number of bits in the bitfield
 * @param key the key of the property to use for the bitfield's indexes
 * @param objs an array of objects which have the key as an index to a number
 * @throws {RangeError} if a value is not found in the bitfield
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
export const getPopulationCount = (field: Bitfield): number => {
  return field.reduce((res, val) => res + popcnt(val), 0);
};

/**
 * @returns the index and position of a bit in the bitfield
 * @throws {TypeError} if `bit` is NaN
 */
export const getPosition = (bit: number): { index: number; position: number } => ({
  index: indexOf(bit),
  position: bit & 31,
});

/**
 * @returns `true` if a given bit is set in the Bitfield
 * @throws {RangeError} if `bit` is not found
 */
export const isSet = (field: Bitfield, bit: number): boolean => {
  const idx = indexOf(bit);
  if (idx === NO_INDEX) throw new RangeError(`Bit ${bit} does not exist in the bitfield.`);
  return !!(field[idx]! & (1 << (bit - idx * BITS_PER_INT)));
};
