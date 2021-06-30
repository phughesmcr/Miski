/**
 * @name        Bitmask
 * @description Utilities for handling and manipulating bitmask arrays
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */

/** A bitmask is simply one of these typed arrays. */
export type Bitmask = Uint32Array;

/**
 * Activate a given bit in a bitmask.
 * @param mask the bitmask to mutate
 * @param bit the bit to activate
 * @returns the mutated bitmask
 */
export function setBitOn(mask: Bitmask, bit: number): Bitmask {
  const size = mask.BYTES_PER_ELEMENT * 8;
  mask[Math.floor(bit / size)] |= 1 << bit % size;
  return mask;
}

/**
 * Deactivate a given bit in a bitmask.
 * @param mask the bitmask to mutate
 * @param bit the bit to deactivate
 * @returns the mutated bitmask
 */
export function setBitOff(mask: Bitmask, bit: number): Bitmask {
  const size = mask.BYTES_PER_ELEMENT * 8;
  mask[Math.floor(bit / size)] &= ~(1 << bit % size);
  return mask;
}

/**
 * Check if a given bit in a bitmask is active.
 * @param mask the mask containing the bit to check
 * @param bit the bit to check
 * @returns `true` if the bit is active, `false` if it is not
 */
export function isBitOn(mask: Bitmask, bit: number): boolean {
  const size = mask.BYTES_PER_ELEMENT * 8;
  return Boolean(mask[Math.floor(bit / size)] & (1 << bit % size));
}

/**
 * Returns the state of a bit in a bitmask
 * @param mask the bitmask
 * @param bit the bit to get
 * @returns 0 or 1
 */
export function getBitFromMask(mask: Bitmask, bit: number): 0 | 1 {
  return isBitOn(mask, bit) === true ? 1 : 0;
}

/**
 * Get the maximum number of bits available for
 * activation in the bitmask.
 * @param mask the mask to examine
 * @returns the maximum bit available
 */
export function getMaxBit(mask: Bitmask): number {
  return mask.BYTES_PER_ELEMENT * mask.length * 8;
}

/**
 * Returns the index of the first 0 in a bitmask
 * @param mask the mask to examine
 * @returns the index of the first free bit, or undefined if none free
 */
export function getFirstFree(mask: Bitmask): number | undefined {
  const max = getMaxBit(mask);
  // @todo:
  // there is a better way to do this by testing the 32nd flag of each epoch first
  // and then starting the loop from that epoch if the 32nd flag isn't set to true
  for (let i = 0; i < max; i++) {
    if (isBitOn(mask, i)) continue;
    return i;
  }
  return;
}

/**
 * Toggle a given bit in a mask
 * @param mask the mask containing the bit
 * @param bit the bit to toggle
 * @returns the modified mask
 */
export function toggleBit(mask: Bitmask, bit: number): Bitmask {
  return isBitOn(mask, bit) ? setBitOff(mask, bit) : setBitOn(mask, bit);
}

/**
 * Create a new bitmask
 * @param length The desired total number of bits/flags in the bitmask. Defaults to `32`.
 * @returns the newly created bitmask
 */
export function createBitmask(length = 32): Bitmask {
  return new Uint32Array(length / 32);
}
