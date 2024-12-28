/** @return `true` if the object has the given key */
export function hasOwnProperty<T>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** @returns `true` if ```typeof n === 'number'``` */
export function isNumber(n: unknown): n is number {
  return typeof n === "number";
}

/** @returns `true` if n is a number, >= 0, <= 2^32 - 1 (4294967295)*/
export function isUint32(n: unknown): n is number {
  return isNumber(n) && !isNaN(n) && n >= 0 && n <= 0xffffffff;
}

/** @returns true if `n` is a Uint32 > 0 */
export function isPositiveUint32(n: unknown): n is number {
  return isUint32(n) && n > 0;
}

/** Test if an object is a valid Record  */
export function isObject<T extends Record<string, unknown>>(object: unknown): object is T {
  return !!(typeof object === "object" && !Array.isArray(object));
}

/**
 * Convert a string representation of a number array to an array of numbers
 * @param str The string representation of the number array
 * @returns The array of numbers
 */
export function numberArrayFromString(str: string): number[] {
  return str
    .replaceAll(/[\[\]]/g, "")
    .split(",")
    .map((n) => parseInt(n, 10));
}

/**
 * A no-operation function
 * @returns {void}
 */
export function noop(..._args: unknown[]): void {}

/**
 * Intersect two bits
 * @param a The first bit
 * @param b The second bit
 * @returns The intersection of the two bits
 */
export function intersectBits(a: number, b: number): number {
  return a & b;
}
