"use strict";

import { getComponentsFromQuery, getEntitiesFromQuery } from "./query.js";
import { SystemInstance } from "./system.js";
import { World } from "./world.js";

/** A filter which returns enabled systems only */
const _filterEnabled = (system: SystemInstance) => system.enabled === true;

/** Call all enabled system's pre functions */
export function runPreSystems(world: World): void {
  const _pre = (system: SystemInstance) => system.pre(getEntitiesFromQuery(system.query));
  [...world.systems].filter(_filterEnabled).forEach(_pre);
}

/**
 * Call all enabled system's post functions.
 * @param world the world to call systems from
 * @param alpha frame interpolation alpha
 */
export function runPostSystems(world: World, alpha = 1): void {
  const _post = (system: SystemInstance) => {
    system.post(getEntitiesFromQuery(system.query), getComponentsFromQuery(system.query), alpha);
  };
  [...world.systems].filter(_filterEnabled).forEach(_post);
}

/**
 * Call all enabled system's update functions
 * @param world the world to call systems from
 * @param delta frame delta time
 */
export function runUpdateSystems(world: World, delta = 0): void {
  const _update = (system: SystemInstance) => {
    system.update(getEntitiesFromQuery(system.query), getComponentsFromQuery(system.query), delta);
  };
  [...world.systems].filter(_filterEnabled).forEach(_update);
}
