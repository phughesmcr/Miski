"use strict";

import { systems } from './definitions.js';

export function registerAllSystems(world) {
  systems.forEach((system) => {
    world.createSystem(system)
  });
  return world;
}