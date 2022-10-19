/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Bitfield } from "./bitfield.js";
import { getLsbIndex } from "./utils.js";

export class BitPool extends Bitfield {
  private nextAvailable = 0;

  constructor(size: number) {
    super(size);
    this.fill(4294967295);
  }

  get setCount() {
    return Bitfield.getSetBitCountInBitfield(this);
  }

  acquire() {
    const { nextAvailable } = this;
    if (nextAvailable <= -1) return -1;
    const index = this[nextAvailable] as number;
    const position = getLsbIndex(index);
    this[nextAvailable] &= ~(1 << position);
    if (this[nextAvailable] === 0) {
      this.nextAvailable = -1;
      for (let i = 0; i < this.length; i++) {
        if (this[i] !== 0) {
          this.nextAvailable = i;
          break;
        }
      }
    }
    return (nextAvailable << 5) + position;
  }

  release(idx: number): BitPool {
    const { index, position } = this.getPosition(idx);
    if (index === -1) return this;
    this[index] |= 1 << position;
    this.nextAvailable = index;
    return this;
  }
}
