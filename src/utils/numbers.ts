/**
 * @description Utilities for handling and manipulating number types
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */

/** Clamps a value between two extremes */
export function clamp(n: number, min?: number, max?: number): number {
  if (min != undefined && n < min) return min;
  if (max != undefined && n > max) return max;
  return n;
}
