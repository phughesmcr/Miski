/* Copyright 2023 the Miski authors. All rights reserved. MIT license. */

/** The number of bits per integer value in the bitfield */
export const BITS_PER_INT = 32;

/** Value representing an erroneous or non-existant index in the bitfield */
export const NO_INDEX = -1;

/** Lookup table for powers of 2 */
export const LOG_2: Record<number, number> = Object.freeze({
  1: 0,
  2: 1,
  4: 2,
  8: 3,
  16: 4,
  32: 5,
  64: 6,
  128: 7,
  256: 8,
  512: 9,
  1024: 10,
  2048: 11,
  4096: 12,
  8192: 13,
  16384: 14,
  32768: 15,
  65536: 16,
  131072: 17,
  262144: 18,
  524288: 19,
  1048576: 20,
  2097152: 21,
  4194304: 22,
  8388608: 23,
  16777216: 24,
  33554432: 25,
  67108864: 26,
  134217728: 27,
  268435456: 28,
  536870912: 29,
  1073741824: 30,
  2147483648: 31,
  [-2147483648]: 31,
});
