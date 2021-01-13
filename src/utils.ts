// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

/** @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign */
export function deepAssign<T>(target: T, ...sources: T[]): T {
    sources.forEach(source => {
      const descriptors = Object.keys(source).reduce((descriptors, key) => {
        const desc = Object.getOwnPropertyDescriptor(source, key);
        if (desc !== undefined) {
          descriptors[key] = desc;
        }
        return descriptors;
      }, {} as Record<string | number | symbol, PropertyDescriptor>);

      Object.getOwnPropertySymbols(source).forEach(sym => {
        const descriptor = Object.getOwnPropertyDescriptor(source, sym);
        if (descriptor?.enumerable) {
          descriptors[sym as unknown as string] = descriptor;
        }
      });
      Object.defineProperties(target, descriptors);
    });
    return target;
}