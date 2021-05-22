// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

export class Mask {
  private mask = 0n;

  constructor(value = 0n) {
    this.mask = value;
  }

  get value(): bigint {
    return this.mask;
  }

  clear(): void {
    this.mask = 0n;
  }

  hasAll(bit: bigint): boolean {
    return Boolean((bit & this.mask) === this.mask);
  }

  hasAny(bit: bigint): boolean {
    return Boolean((this.mask === 0n) || ((bit & this.mask) > 0));
  }

  hasNone(bit: bigint): boolean {
    return Boolean((bit & this.mask) === 0n);
  }

  off(bit: bigint): bigint {
    this.mask &= ~(1n << BigInt(bit));
    return this.mask;
  }

  on(bit: bigint): bigint {
    this.mask |= (1n << BigInt(bit));
    return this.mask;
  }
}
