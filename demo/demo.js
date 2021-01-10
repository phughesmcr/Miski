"use strict";

import { createWorld } from "../dist/esm/index.min.js";

const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

// create our world - most functions take place through the world object
const world = createWorld({
  initialPoolSize: 10,
  maxComponents: 1024,
});

// define some components - the properties given here are the default properties of the component
const size = world.createComponent({
  name: "size",
  properties: {
    height: 10,
    width: 10,
  },
});

const colour = world.createComponent({
  name: "colour",
  properties: {
    r: 0,
    g: 0,
    b: 0,
  },
});

const position = world.createComponent({
  name: "position",
  properties: {
    x: 0,
    y: 0,
  },
});

const velocity = world.createComponent({
  name: "velocity",
  properties: {
    x: 0,
    y: 0,
  },
});

// random function
function rnd(min, max) { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// create 1000 entities
const entities = [];
for (let i = 0; i < 1000; i++) {
  // create entity
  const entity = world.createEntity();
  // add components
  world.addComponentsToEntity(entity, size, colour, position, velocity);
  // overwrite some of the default properties with entity specific properties
  // N.B. you can access the individual properties of course (e.g. box.components.colour.r)
  entity.components.colour = { r: rnd(0, 255), g: rnd(0, 255), b: rnd(0, 255) };
  entity.components.position = { x: rnd(0, canvas.width - entity.components.size.width), y: rnd(0, canvas.height - entity.components.size.height) };
  entity.components.velocity = { x: rnd(-100, 100), y: rnd(-100, 100) }
  // store in array
  entities.push(entity);
}

// a simple function to draw the box to the canvas
// N.B. function you intend to use as systems must take the following:
//     dt: {number} frame delta time
//     entities {Entity[]} an array of entities
function move(dt, entities) {
  // process each entity
  entities.forEach((entity) => {
    // modify component properties
    entity.components.position.x += entity.components.velocity.x * dt;
    entity.components.position.y += entity.components.velocity.y * dt;
    if (entity.components.position.x >= (canvas.width - entity.components.size.width) || entity.components.position.x <= entity.components.size.width) {
      entity.components.velocity.x = -(entity.components.velocity.x);
    }
    if (entity.components.position.y >= (canvas.height - entity.components.size.height) || entity.components.position.y <= entity.components.size.height) {
      entity.components.velocity.y = -(entity.components.velocity.y);
    }

  });
}

function render(int, entities) {
  // clear canvas every frame
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // process each entity
  entities.forEach((entity) => {
    // draw
    ctx.fillStyle = `rgb(${entity.components.colour.r}, ${entity.components.colour.g}, ${entity.components.colour.b})`;
    ctx.fillRect(
      entity.components.position.x,
      entity.components.position.y,
      entity.components.size.width,
      entity.components.size.height,
    );
  });
  // draw fps counter
  ctx.fillStyle = '#fff'
  ctx.font = '32px sans-serif';
  ctx.fillText(`${f.toFixed()}fps`, 10, 35);
}

// turn the draw function into a system
const drawer = world.createSystem({
  // the components required in the function
  components: [
    colour,
    position,
    size,
    velocity,
  ],
  // the function itself
  updateFn: move,
  renderFn: render,
});

// enable the system
drawer.enable();


// FPS counter
let f = 0
let ld = 0;
let lu = Number.NEGATIVE_INFINITY;
function updateFPS(time) {
  if (time <= lu + 1000) {
    ld += 1;
    return;
  }
  f =  0.9 * ld * 1000 / (time - lu) + 0.1 * f;
  lu = time;
  ld = 0;
}

// game loop
let frameId = null;
let last = null;
let acc = 0;
let tempo = 1/120;
let dt = tempo;

function onTick(time) {
  frameId = requestAnimationFrame(onTick)
  if (last !== null) {
    acc += (time - last) / 1000;
    while (acc > dt) {
      world.update(dt);
      acc -= dt;
    }
  }
  last = time;
  updateFPS(time);
  world.render(acc / tempo);
}

frameId = requestAnimationFrame(onTick)