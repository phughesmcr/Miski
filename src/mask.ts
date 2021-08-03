"use strict";

export type Bitmask = Uint32Array;

export function createBitmask(length = 32): Bitmask {
  return new Uint32Array(Math.ceil(length / 32));
}

export function getMaxBit(mask: Bitmask): number {
  return 32 * mask.length;
}

export function isValidBit(mask: Bitmask, bit: number): boolean {
  if (bit < 0 || bit > getMaxBit(mask)) return false;
  return true;
}

export function isBitOn(mask: Bitmask, bit: number): boolean {
  if (!isValidBit(mask, bit)) throw new SyntaxError(`Bit ${bit} does not exist on mask.`);
  return Boolean(mask[Math.floor(bit / 32)] & (1 << bit % 32));
}

export function setBitOn(mask: Bitmask, bit: number): Bitmask {
  if (!isValidBit(mask, bit)) throw new SyntaxError(`Bit ${bit} does not exist on mask.`);
  mask[Math.floor(bit / 32)] |= 1 << bit % 32;
  return mask;
}

export function setBitOff(mask: Bitmask, bit: number): Bitmask {
  if (!isValidBit(mask, bit)) throw new SyntaxError(`Bit ${bit} does not exist on mask.`);
  mask[Math.floor(bit / 32)] &= ~(1 << bit % 32);
  return mask;
}

/**
 * Compresses the mask into a smaller integer.
 * Tested up to 4096 components.
 */
export function getMaskId(mask: Bitmask): number {
  const max = getMaxBit(mask);
  let id = 0;
  for (let i = 0, n = mask.length; i < n; i++) {
    id += (mask[i] ^ max) + i;
  }
  return parseInt(Math.abs(id).toString(8), 8);
}
