// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

export interface Mask {
  clear: () => void;
  has: (bit: bigint | number) => boolean;
  isOn: (bit: bigint | number) => boolean;
  off: (bit: bigint | number) => bigint;
  on: (bit: bigint | number) => bigint;
  set: (bit: bigint | number, value: boolean) => bigint;
  toArray: () => number[];
  toggle: (bit: bigint | number) => bigint;
  toNumber: () => number;
  toString: () => string;
  value: () => bigint;
}

/**
 * Creates a bigint bitmask
 * @param n the initial mask - defaults to 0n
 */
export function createMask(n: bigint | number = 0n): Mask {
  if (typeof n === 'number') n = BigInt(n);

  // the actual bitmask value
  let _mask = 1n << n;

  /** @returns the mask's value */
  const value = () => _mask;

  /** Reset the bitmask */
  const clear = (): bigint => _mask = 1n << 0n;

  /**
   * Check a bit in the mask
   * @param bit the bit to test
   */
  const has = function(bit: bigint | number): boolean {
    if (typeof bit === 'number') bit = BigInt(bit);
    return ((_mask & bit) === _mask) ? true : false;
  };

  /**
   * Set a bit in the mask to false/off
   * @param bit the bit to set
   */
  const off = (bit: bigint | number): bigint => {
    if (typeof bit === 'number') bit = BigInt(bit);
    _mask &= ~(1n << bit);
    return _mask;
  };

  /**
   * Set a bit in the mask to true/on
   * @param bit the bit to set
   */
  const on = (bit: bigint | number): bigint => {
    if (typeof bit === 'number') bit = BigInt(bit);
    _mask |= (1n << bit);
    return _mask;
  };

  /**
   * Set a bit in the mask to a give value
   * @param bit the bit to set
   * @param value the value - true / false
   */
  const set = (bit: bigint | number, value: boolean): bigint => {
    if (value === true) {
      return on(bit);
    } else {
      return off(bit);
    }
  };

  /**
   * Test if a bit in the mask is on/true
   * @param bit
   */
  const isOn = (bit: bigint | number): boolean => {
    if (typeof bit === 'number') bit = BigInt(bit);
    return ((_mask & (1n << bit)) !== 0n) ? true : false;
  };

  /**
   * Toggle a bit in the mask
   * @param bit the bit to toggle
   */
  const toggle = (bit: bigint | number): bigint => {
    if (typeof bit === 'number') bit = BigInt(bit);
    _mask ^= (1n << bit);
    return _mask;
  };

  /** Convert the mask to a binary string */
  const toString = (): string => _mask.toString(2);

  /**
   * Convert the mask to a number
   * N.B. converting a bigint to number may result in loss of precision
   */
  const toNumber = (): number => Number(_mask);

  /** Convert the mask to an array of 0s and 1s */
  const toArray = (): number[] => _mask.toString(2).split("").map((n) => parseInt(n, 10));

  return Object.freeze({
    clear,
    has,
    isOn,
    off,
    on,
    set,
    toArray,
    toggle,
    toNumber,
    toString,
    value,
  });
}
