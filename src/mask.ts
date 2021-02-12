// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

export interface Mask {
  clear: () => void;
  has: (bit: bigint | number) => boolean;
  on: (bit: bigint | number) => bigint;
  off: (bit: bigint | number) => bigint;
  set: (bit: bigint | number, value: boolean) => bigint;
  isOn: (bit: bigint | number) => boolean;
  toggle: (bit: bigint | number) => bigint;
  toArray: () => number[];
  toString: () => string;
  toNumber: () => number;
  value: () => bigint;
}

export function createMask(n: bigint | number = 0n): Mask {
  if (typeof n === 'number') n = BigInt(n);

  let _mask = 1n << n;

  const value = () => _mask;

  const clear = (): void => {
    _mask = 1n << 0n;
  };

  const has = function(bit: bigint | number): boolean {
    if (typeof bit === 'number') {
      bit = BigInt(bit);
    }
    return ((_mask & bit) === _mask) ? true : false;
  };

  const off = (bit: bigint | number): bigint => {
    if (typeof bit === 'number') {
      bit = BigInt(bit);
    }
    _mask &= ~(1n << bit);
    return _mask;
  };

  const on = (bit: bigint | number): bigint => {
    if (typeof bit === 'number') {
      bit = BigInt(bit);
    }
    _mask |= (1n << bit);
    return _mask;
  };

  const set = (bit: bigint | number, value: boolean): bigint => {
    if (value === true) {
      return on(bit);
    } else {
      return off(bit);
    }
  };

  const isOn = (bit: bigint | number): boolean => {
    if (typeof bit === 'number') {
      bit = BigInt(bit);
    }
    return ((_mask & (1n << bit)) !== 0n) ? true : false;
  };

  const toggle = (bit: bigint | number): bigint => {
    if (typeof bit === 'number') {
      bit = BigInt(bit);
    }
    _mask ^= (1n << bit);
    return _mask;
  };

  const toString = (): string => _mask.toString(2);

  const toNumber = (): number => Number(_mask);

  const toArray = (): number[] => _mask.toString(2).split("").map((n) => parseInt(n, 10));

  return Object.freeze({
    clear,
    has,
    on,
    off,
    set,
    isOn,
    toggle,
    toArray,
    toString,
    toNumber,
    value,
  });
}
