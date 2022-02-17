/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { World } from "./world.js";

/** */
export type System<T extends (...args: unknown[]) => unknown> = (world: World, ...args: Parameters<T>) => unknown;
