"use strict";

export function createPlayer(world) {
  const player = world.createEntity();
  const components = [];
  [
    "player",
    "position",
    "velocity",
    "direction",
    "heading",
    "raycaster",
    "keyboardinput",
    "mouseinput"
  ].forEach((req) => {
    const component = world.getComponentByName(req);
    if (!component) throw new Error(`error creating player. no component "${req}" found.`);
    components.push(component);
  });
  world.addComponentsToEntity(player, ...components);
  return player;
}