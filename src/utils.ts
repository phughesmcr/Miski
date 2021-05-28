/* eslint-disable max-len */
// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

/** An array of strings that cannot be used for component or system names */
export const FORBIDDEN_NAMES = Object.freeze([
  // component properties
  "_world",
  "defaults",
  "id",
  "name",
  // object properties
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "prototype",
  "toLocaleString",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupGetter__",
  "__proto__",
]);

/** Adds a toggleable 'enabled' property */
export interface Toggleable {
  readonly enabled: boolean;
  disable: () => void;
  enable: () => void;
}

/** Clamps a value between two extremes */
export function clamp(n: number, min?: number, max?: number): number {
  if (min != undefined && n < min) return min;
  if (max != undefined && n > max) return max;
  return n;
}

/** Check if a string is a valid property name */
export function validName(str: string): boolean {
  str = str.trim();
  return /^(?![0-9])[a-zA-Z0-9$_]+$/.test(str) && !(FORBIDDEN_NAMES.includes(str));
}

/** Determine if a given item is an object and not an array */
export function isObject(item: unknown): boolean {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item));
}

/** Delete all the properties from an object */
export function clearObject(obj: Record<string, unknown>): Record<string, unknown> {
  Object.keys(obj).forEach((key) => delete obj[key]);
  return obj;
}

/** Recursively copy the properties of source objects to a target object */
export function deepAssignObjects(target: Record<string, unknown>, ...sources: Record<string, unknown>[]): Record<string, unknown> {
  if (!sources || !sources.length) return target;

  const descriptors: Record<string | number | symbol, PropertyDescriptor> = {};
  const source = sources.shift() as Record<string, unknown>;

  if (isObject(target) && isObject(source)) {
    // keys
    Object.keys(source).forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor !== undefined) {
        descriptors[key] = {...descriptor};
        if (isObject(descriptor.value)) {
          deepAssignObjects(descriptor.value as Record<string, unknown>, source[key] as Record<string, unknown>);
        } else if (Array.isArray(descriptor.value)) {
          descriptor.value = [...source[key] as Array<unknown>];
        }
      }
    });
    // symbols
    Object.getOwnPropertySymbols(source).forEach((symbol) => {
      const descriptor = Object.getOwnPropertyDescriptor(source, symbol);
      if (descriptor !== undefined && descriptor.enumerable) {
        descriptors[symbol as unknown as string] = {...descriptor};
        if (isObject(descriptor.value)) {
          deepAssignObjects(descriptor.value as Record<string, unknown>, source[symbol as unknown as string] as Record<string, unknown>);
        } else if (Array.isArray(descriptor.value)) {
          descriptor.value = [...source[symbol as unknown as string] as Array<unknown>];
        }
      }
    });
    Object.defineProperties(target, descriptors);
  }

  return deepAssignObjects(target, ...sources);
}
