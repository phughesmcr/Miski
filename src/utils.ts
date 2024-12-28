/** @return `true` if the object has the given key */
export const hasOwnProperty = <T>(object: T, key: PropertyKey): key is keyof T => {
  return Object.prototype.hasOwnProperty.call(object, key);
};

/** @returns `true` if ```typeof n === 'number'``` */
export const isNumber = (n: unknown): n is number => typeof n === "number";

/** @returns `true` if n is a number, >= 0, <= 2^32 - 1 (4294967295)*/
export const isUint32 = (n: number): n is number => {
  return isNumber(n) && !isNaN(n) && n >= 0 && n <= 0xffffffff;
};

/** @returns true if `n` is a Uint32 > 0 */
export const isPositiveUint32 = (n: number): n is number => isUint32(n) && n > 0;

/** Test if an object is a valid Record  */
export const isObject = <T extends Record<string, unknown>>(object: unknown): object is T => {
  return !!(typeof object === "object" && !Array.isArray(object));
};
