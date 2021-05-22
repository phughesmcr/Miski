"use strict";

import { createWorld } from "../../../dist/esm/index.min.js";
import { createBoundaries } from './things/boundaries.js';
import { registerAllComponents } from './components/components.js';
import { registerAllSystems } from "./systems/systems.js";
import { createPlayer } from './things/player.js';

// cache main html canvas and context
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', {alpha: true, desynchronized: false});

// create buffer canvas and context in memory
const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = canvas.width;
bufferCanvas.height = canvas.height;
const bufferCtx = bufferCanvas.getContext('2d', {alpha: true, desynchronized: true});

// create world object
const world = createWorld();

// register our components
registerAllComponents(world);

// register and enable systems
registerAllSystems(world);
world.systems.forEach((system) => system.enable());

// add canvas and buffer to world entity
const cCnv = world.getComponentByName('canvas');
const cBuffer = world.getComponentByName('buffer');
world.addComponentsToEntity(world.entity, cCnv, cBuffer);
world.entity.components.canvas.ctx = ctx;
world.entity.components.buffer.ctx = bufferCtx;

// draw boundaries
const boundaries = createBoundaries(world, 5);

// create player
const player = createPlayer(world);
player.components.position = { x: bufferCanvas.width / 2, y: bufferCanvas.height / 2 };
player.components.keyboardinput.listenTo(window);
player.components.mouseinput.listenTo(window);
player.components.raycaster.fov = 90;

// keyboard input
const kb = player.components.keyboardinput;
// W
kb.addMapping(87, (keyState) => {
  if (keyState === 1) {
    player.components.direction.y = -1;
    player.components.velocity.y = 100;
  } else {
    player.components.velocity.y = 0;
  }
});
// S
kb.addMapping(83, (keyState) => {
  if (keyState === 1) {
    player.components.direction.y = 1;
    player.components.velocity.y = 100;
  } else {
    player.components.velocity.y = 0;
  }
});
// A
kb.addMapping(65, (keyState) => {
  if (keyState === 1) {
    player.components.direction.x = -1;
    player.components.velocity.x = 100;
  } else {
    player.components.velocity.x = 0;
  }
});
// D
kb.addMapping(68, (keyState) => {
  if (keyState === 1) {
    player.components.direction.x = 1;
    player.components.velocity.x = 100;
  } else {
    player.components.velocity.x = 0;
  }
});

// mouse input
const mouse = player.components.mouseinput;
mouse.addMapping(0, (keyState) => {
  if (keyState) {
    player.components.heading.heading += 10;
    console.log(player.components.heading.heading);
  }

});

// game loop
let accumulator = 0;
let frame;
let frameDuration = 1 / 60;
let lastTime = null;
let running = true;
function onTick(time) {
  if (running) {
    frame = window.requestAnimationFrame(onTick);
    if (lastTime !== null) {
      world.preUpdate();
      accumulator = Math.min(1, accumulator + (time - lastTime) * 0.001);
      let updateCount = 0;
      while (accumulator > frameDuration) {
        if (updateCount >= 240) {
          accumulator = frameDuration;
          break;
        }
        world.update(frameDuration);
        accumulator -= frameDuration;
        updateCount++;
      }
    }
    lastTime = time;
    world.render(accumulator / frameDuration);
  }
}
frame = window.requestAnimationFrame(onTick);

// expose world on window
window.world = world;
