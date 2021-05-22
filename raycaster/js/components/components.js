"use strict";

import { components } from './definitions.js';

export function registerAllComponents(world) {
  components.forEach((component) => world.createComponent(component));
  return world;
}