"use strict";

import { getComponentsFromQuery, getEntitiesFromQuery } from "./query.js";
import { World } from "./world.js";

/** Call all enabled system's pre functions */
export function runPreSystems(world: World): void {
  const { systems } = world;
  for (let i = 0, n = systems.length; i < n; i++) {
    const system = systems[i];
    if (!system.enabled) continue;
    system.pre(getEntitiesFromQuery(system.query));
  }
}

/**
 * Call all enabled system's post functions.
 * @param world the world to call systems from
 * @param alpha frame interpolation alpha
 */
export function runPostSystems(world: World, alpha = 1): void {
  const { systems } = world;
  for (let i = 0, n = systems.length; i < n; i++) {
    const system = systems[i];
    if (!system.enabled) continue;
    system.post(getEntitiesFromQuery(system.query), getComponentsFromQuery(system.query), alpha);
  }
}

/**
 * Call all enabled system's update functions
 * @param world the world to call systems from
 * @param delta frame delta time
 */
export function runUpdateSystems(world: World, delta = 0): void {
  const { systems } = world;
  for (let i = 0, n = systems.length; i < n; i++) {
    const system = systems[i];
    if (!system.enabled) continue;
    system.update(getEntitiesFromQuery(system.query), getComponentsFromQuery(system.query), delta);
  }
}
