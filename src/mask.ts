// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

export type Mask = Readonly<{
  value: bigint;
  has(n: bigint): boolean;
  set(n: bigint): void;
  test(n: bigint): boolean;
  toggle(n: bigint): void;
  toString(): string;
  unset(n: bigint): void;
}>;

export function combineMasks(...masks: Mask[]): Mask {
  let n = 0n;
  masks.forEach((mask) => n |= mask.value);
  return createMask(n);
}

export function createMask(n: bigint): Mask {
  if (typeof n === 'number') n = BigInt(n);

  let { mask } = { mask: 1n << n };

  const getters = {
    get value(): bigint {
      return mask;
    }
  };

  const has = function(n: bigint): boolean {
    if (typeof n === 'number') {
      n = BigInt(n);
    }
    return Boolean((mask & n) === mask);
  };

  const set = function(n: bigint): void {
    if (typeof n === 'number') {
      n = BigInt(n);
    }
    mask |= (1n << n);
  };

  const test = function(n: bigint): boolean {
    if (typeof n === 'number') {
      n = BigInt(n);
    }
    return Boolean((mask & (1n << n)) !== 0n);
  };

  const toggle = function(n: bigint): void {
    if (typeof n === 'number') {
      n = BigInt(n);
    }
    mask ^= (1n << n);
  };

  const toString = function(): string {
    return mask.toString(2);
  };

  const unset = function(n: bigint): void {
    if (typeof n === 'number') {
      n = BigInt(n);
    }
    mask &= ~(1n << n);
  };

  return Object.freeze(
    Object.assign(
      getters,
      {
        has,
        set,
        test,
        toggle,
        toString,
        unset,
      }
    )
  );
}
