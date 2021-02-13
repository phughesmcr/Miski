// Miski - Flocking Boids Example!
"use strict";

// import the createWorld function from Miski
// import { createWorld } from "../../dist/esm/index.min.js";
import { createWorld } from "https://gitcdn.link/repo/phughesmcr/Miski/master/dist/esm/index.min.js";

// cache main canvas
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', {alpha: false, desynchronized: false});
ctx.imageSmoothingEnabled = false;

// create buffer canvas
const bufferCnv = document.createElement('canvas');
bufferCnv.width = canvas.width;
bufferCnv.height = canvas.height;
const bufferCtx = bufferCnv.getContext('2d', {alpha: false, desynchronized: true});
bufferCtx.imageSmoothingEnabled = false;

// ui elements
const sFps = document.getElementById('sFps');

// create our world - most functions take place through the world object
const world = createWorld();

// expose world on window
window.world = world;

// create some singleton categories that are going to reside on the world.entity singleton entity
// the properties given when registering a component become its default properties
const cCanvas = world.registerComponent({
  name: "canvas",
  properties: {
    ctx: ctx,
    get canvas() {
      return this.ctx.canvas;
    }
  },
  entityLimit: 1,
  removable: false,
});

const cBuffer = world.registerComponent({
  name: "buffer",
  properties: {
    ctx: bufferCtx,
  },
  entityLimit: 1,
  removable: false,
});

// add the components to the world entity
world.addComponentsToEntity(world.entity, cCanvas, cBuffer);

// modify the components' properties through the ._. pathway
world.entity._.canvas.ctx = ctx;
world.entity._.buffer.ctx = bufferCtx;

// define some reusable components for our boids
const cSize = world.registerComponent({
  name: "size",
  properties: {
    height: 10,
    width: 10,
  },
});

const cColour = world.registerComponent({
  name: "colour",
  properties: {
    r: 255,
    g: 255,
    b: 255,
  },
});

const cPosition = world.registerComponent({
  name: "position",
  properties: {
    x: 0,
    y: 0,
  },
});

const cVelocity = world.registerComponent({
  name: "velocity",
  properties: {
    x: 0,
    y: 0,
  },
});

const cAcceleration = world.registerComponent({
  name: "acceleration",
  properties: {
    x: 0,
    y: 0,
  },
});

const cAlignment = world.registerComponent({
  name: "alignment",
  properties: {

  }
});

// random utility functions
function rnd(min, max) { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}
function clamp(n, min, max) {
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

// entity container
const boids = [];
window.boids = boids;
// boid factory
function createBoid() {
  // create entity
  const boid = world.createEntity();
  // add components
  world.addComponentsToEntity(boid, cSize, cColour, cPosition, cVelocity, cAcceleration);
  // overwrite some of the default properties with entity specific properties
  // N.B. you can access the individual properties too of course (e.g. boid._.colour.r)
  boid._.colour = { r: rnd(0, 255), g: rnd(0, 255), b: rnd(0, 255) };
  boid._.size = { width: 20, height: 20 };
  boid._.position = {x: rnd(0, canvas.width - boid._.size.width), y: rnd(0, canvas.height - boid._.size.height)};
  boid._.velocity = {x: rnd(-100, 100), y: rnd(-100, 100)};
  boid._.acceleration = {x: rnd(-1, 1), y: rnd(-1, 1)};
  return boid;
}

// create 1000 boxes
for (let i = 0; i < 1000; i++) {
 const boid = createBoid();
 boids.push(boid);
}

// create a system to handle the boids
const boidSystem = world.registerSystem({
  name: "boids",
  components: [
    cSize,
    cColour,
    cPosition,
    cVelocity,
    cAcceleration,
  ],
  // align function needs to gfo in preupdate
  update: function(dt, entities, system) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      const entity = entities[i];
      const cnv = world.entity._.canvas.ctx.canvas;
      if (entity._.position.x >= (cnv.width - entity._.size.width) || (entity._.position.x <= 0)) {
        entity._.velocity.x = -entity._.velocity.x;
      }
      if (entity._.position.y >= (cnv.height - entity._.size.height) || (entity._.position.y <= 0)) {
        entity._.velocity.y = -entity._.velocity.y;
      }
      entity._.position.x += entity._.velocity.x * dt;
      entity._.position.y += entity._.velocity.y * dt;
      entity._.velocity.x += entity._.acceleration.x * dt;
      entity._.velocity.y += entity._.acceleration.y * dt;
    };
  },
  postUpdate: function(int, entities, system) {
    if (!entities.length) return;
    const worldCtx = world.entity._.buffer.ctx;
    // clear canvas every frame
    worldCtx.fillStyle = '#000'
    worldCtx.fillRect(0, 0, worldCtx.canvas.width, worldCtx.canvas.height);
    // process each entity
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      const entity = entities[i];
      // draw
      const c = entity._.colour;
      worldCtx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      worldCtx.fillRect(
        entity._.position.x,
        entity._.position.y,
        entity._.size.width,
        entity._.size.height,
      );
    }
    // draw fps counter
    sFps.textContent = f.toFixed(3);
  },
});
boidSystem.enable();

const renderer = world.registerSystem({
  name: "renderer",
  components: [
    cCanvas,
    cBuffer,
  ],
  postUpdate: function(int, entities, system) {
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      const entity = entities[i];
      const cnv = entity._.canvas.ctx;
      const buf = entity._.buffer.ctx;
      cnv.clearRect(0, 0, cnv.canvas.width, cnv.canvas.height);
      cnv.drawImage(buf.canvas, 0, 0);
      buf.clearRect(0, 0, buf.canvas.width, buf.canvas.height);
    }
  }
});
renderer.enable();

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
let last = null;
let acc = 0;
const tempo = 1/60;
let dt = tempo;

function onTick(time) {
  window.requestAnimationFrame(onTick)
  if (last !== null) {
    acc += (time - last) * 0.001;
    let updateCount = 0;
    world.preUpdate();
    while (acc > dt) {
      if (updateCount >= 240) {
        acc = 1;
        break;
      }
      world.update(dt);
      acc -= dt;
      updateCount++;
    }
  }
  last = time;
  updateFPS(time);
  world.postUpdate(acc / tempo);
}
window.requestAnimationFrame(onTick);

document.getElementById('sEntLen').textContent = world.getEntities().length;
document.getElementById('sCompLen').textContent = world.getComponents().length;
document.getElementById('sSysLen').textContent = world.getSystems().length;

function onResize(e) {
  document.getElementById('sCnvW').textContent = canvas.clientWidth;
  document.getElementById('sCnvH').textContent = canvas.clientHeight;
}
window.addEventListener('resize', onResize, {passive: true});
onResize();