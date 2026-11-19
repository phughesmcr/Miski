import { ComponentDataError } from "@/errors.ts";
import type { TypedArray } from "@/types/partitions.ts";

/**
 * Canonicalize one numeric value exactly as its declared typed column will store it.
 * Rejects non-finite inputs, and finite inputs that a floating-point column would overflow to infinity.
 * Integer columns wrap or truncate like any typed-array write (`Uint8Array` 300 stores 44); they do not reject.
 * @throws {ComponentDataError} If `value` is not a finite number, or the column cannot represent it
 */
export function canonicalizeStoredValue(
  component: string,
  key: string,
  value: number,
  scratch: TypedArray,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ComponentDataError(`Component ${component} data field "${key}" must be a finite number.`);
  }
  scratch[0] = Object.is(value, -0) ? 0 : value;
  const coerced = scratch[0];
  if (!Number.isFinite(coerced)) {
    throw new ComponentDataError(`Component ${component} data field "${key}" is outside its storage range.`);
  }
  if (Object.is(coerced, -0)) scratch[0] = 0;
  return scratch[0]!;
}
