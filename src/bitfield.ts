/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */

import { isTypedArray, isUint32 } from "./utils.js";

export interface BitfieldSpec {
  /** The number of bits/flags required */
  capacity: number;
  /** Optional pre-created bitfield array (avoids new array generation) */
  array?: Uint32Array;
}

export interface Bitfield {
  /** The size of the bitfield */
  capacity: number;
  /** The underlying bit array */
  array: Uint32Array;
  /**
   * Set all bits to 0
   * @returns `true` if the bitfield array was cleared successfully
   */
  clear: () => Bitfield;
  /** @returns a new Bitfield based on this Bitfield */
  copy: () => Bitfield;
  /** @returns `true` if a given bit is 'on' (e.g., truthy) in the Bitfield */
  isOn: (bit: number) => boolean;
  /**
   * Set a bit 'off' (e.g., falsy) in the Bitfield
   * @returns `true` if the bit was manipulated successfully
   */
  off: (bit: number) => Bitfield;
  /**
   * Set a bit 'on' (e.g., truthy) in the Bitfield
   * @returns `true` if the bit was manipulated successfully
   */
  on: (bit: number) => Bitfield;
  /**
   * Toggle a bit in the Bitfield
   * @returns `true` if the bit was manipulated successfully
   */
  toggle: (bit: number) => Bitfield;
  /** @returns the bitfield array as a string */
  toString: () => string;
}

/** Curried bitfield factory function */
export function bitfieldCloner(bitfield: Bitfield) {
  return function () {
    return bitfield.copy().clear();
  };
}

/**
 * Create a new Bitfield
 * @param spec The Bitfield's specification object
 * @param spec.capacity The number of bits/flags
 * @param spec.array Optional pre-created bitfield array (avoids new array generation)
 */
export function bitfield(spec: BitfieldSpec): Bitfield {
  const { capacity, array } = validateSpec(spec);
  const state = { capacity, array } as Bitfield;
  const bitToIdx = getBitIndex(capacity);
  const { clear } = clearer(state);
  const { copy } = copier(state);
  const { isOn } = onChecker(state, bitToIdx);
  const { off } = offer(state, bitToIdx);
  const { on } = onner(state, bitToIdx);
  const { toggle } = toggler(state, bitToIdx);
  const { toString } = stringifier(state);
  return Object.freeze(Object.assign(state, { clear, copy, isOn, off, on, toggle, toString }));
}

/** Validates and returns a BitfieldSpec object */
function validateSpec(spec: BitfieldSpec): Required<BitfieldSpec> {
  if (!spec) throw new SyntaxError("Bitfield: a specification object is required.");
  const { capacity, array } = spec;
  if (!isUint32(capacity)) throw new SyntaxError("Bitfield: spec.capacity is invalid.");
  if (array) {
    if (!isTypedArray(array)) throw new TypeError("Bitfield: spec.array is invalid.");
    if (array.length !== (capacity + 31) >>> 5) throw new SyntaxError("Bitfield: spec.array is wrong size.");
  }
  return { capacity, array: array || new Uint32Array((capacity + 31) >>> 5) };
}

/** Check if bit is valid and convert to array index */
function getBitIndex(capacity: number): (bit: number) => number {
  return function bitToIdx(bit: number): number {
    if (bit == undefined || isNaN(bit) || bit < 0 || bit > capacity) return -1;
    return bit >>> 5;
  };
}

function clearer(state: Bitfield) {
  const { array } = state;
  return {
    /**
     * Set all bits to 0
     * @returns `true` if the bitfield array was cleared successfully
     */
    clear: function (): Bitfield {
      array.fill(0);
      return state;
    },
  };
}

function copier(state: Bitfield) {
  const { capacity, array } = state;
  return {
    /** @returns a new Bitfield based on this Bitfield */
    copy: function (): Bitfield {
      return bitfield({ capacity, array: array.slice() });
    },
  };
}

function offer(state: Bitfield, bitToIdx: (bit: number) => number) {
  const { array } = state;
  return {
    /**
     * Set a bit 'off' (e.g., falsy) in the Bitfield
     * @returns `true` if the bit was manipulated successfully
     */
    off: function (bit: number): Bitfield {
      const i = bitToIdx(bit);
      if (i === -1) return state;
      array[i] &= ~(1 << (bit - i * 32));
      return state;
    },
  };
}

function onner(state: Bitfield, bitToIdx: (bit: number) => number) {
  const { array } = state;
  return {
    /**
     * Set a bit 'on' (e.g., truthy) in the Bitfield
     * @returns `true` if the bit was manipulated successfully
     */
    on: function (bit: number): Bitfield {
      const i = bitToIdx(bit);
      if (i === -1) return state;
      array[i] |= 1 << (bit - i * 32);
      return state;
    },
  };
}

function onChecker(state: Bitfield, bitToIdx: (bit: number) => number) {
  const { array } = state;
  return {
    /** @returns `true` if a given bit is 'on' (e.g., truthy) in the Bitfield */
    isOn: function (bit: number): boolean {
      const i = bitToIdx(bit);
      if (i === -1) return false;
      const cell = array[i];
      if (!cell) return false;
      return Boolean(cell & (1 << (bit - i * 32)));
    },
  };
}

function stringifier(state: Bitfield) {
  const { array } = state;
  return {
    /** @returns the bitfield array as a string */
    toString: function (): string {
      return array.toString();
    },
  };
}

function toggler(state: Bitfield, bitToIdx: (bit: number) => number) {
  const { array } = state;
  return {
    /**
     * Toggle a bit in the Bitfield
     * @returns `true` if the bit was manipulated successfully
     */
    toggle: function (bit: number): Bitfield {
      const i = bitToIdx(bit);
      if (i === -1) return state;
      array[i] ^= 1 << (bit - i * 32);
      return state;
    },
  };
}
