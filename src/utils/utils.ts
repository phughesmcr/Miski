// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Component } from '../component/component';
import { createMask } from './mask';

export type DisallowedKeys =
    "constructor" |
    "hasOwnProperty" |
    "isPrototypeOf" |
    "propertyIsEnumerable" |
    "prototype" |
    "toLocaleString" |
    "toString" |
    "valueOf" |
    "__defineGetter__" |
    "__defineSetter__" |
    "__lookupGetter__" |
    "__lookupGetter__" |
    "__proto__";

// eslint-disable-next-line max-len
export type RestrictedObject<T extends unknown> = Pick<T, Exclude<keyof T, DisallowedKeys>>;

/** @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign */
export function deepAssign<T>(target: T, ...sources: T[]): T {
  const lSources = sources.length;
  if (!sources || !lSources) return target;

  const descriptors: Record<string | number | symbol, PropertyDescriptor> = {};

  for (let i = 0; i < lSources; i++) {
    const source = sources[i];
    // keys
    const keys = Object.keys(source);
    const lKeys = keys.length;
    for (let j = 0; j < lKeys; j++) {
      const key = keys[j];
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor && descriptor.enumerable) {
        descriptors[key] = descriptor;
      }
    }
    // symbols
    const symbols = Object.getOwnPropertySymbols(source);
    for (let j = 0; j < symbols.length; j++) {
      const symbol = symbols[j];
      const descriptor = Object.getOwnPropertyDescriptor(source, symbol);
      if (descriptor && descriptor.enumerable) {
        descriptors[symbol as unknown as string] = descriptor;
      }
    }
  }
  Object.defineProperties(target, descriptors);
  return target;
}

export function componentsToArchetype<T>(...components: Component<T>[]): bigint {
  const archetype = createMask();
  components.forEach((component) => archetype.on(component.id));
  return archetype.value();
}

export function generateId(): string {
  return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

export function clearObject(obj: Record<string, unknown>): Record<string, unknown> {
  Object.keys(obj).forEach((key) => delete obj[key]);
  return obj;
}

export function clearArray<T>(arr: Array<T>): Array<T> {
  arr.length = 0;
  return arr;
}
