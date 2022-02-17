"use strict";

import { createComponent, createQuery, createWorld } from "../../dist/miski.min.js";

function rnd(a, b) { return Math.random() * (b - a) + a; }

const ENTITIES = 64;
let SPEED = 50;

const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d');
ctx.strokeStyle = "#000";
ctx.lineWidth = 5;

// 1. Define components
const cColour = createComponent({ name: "colour", schema: { r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray }});
const cPosition = createComponent({ name: "position", schema: { x: Float32Array, y: Float32Array }});
const cSize = createComponent({ name: "size", schema: { value: Uint32Array }});
const cVelocity = createComponent({ name: "velocity", schema: { dx: Float32Array, dy: Float32Array }});

// 1b. Components can also be Tags, just omit the schema
const tBorder = createComponent({ name: "border" });

// 2. Create queries to group objects by components for use in systems
const qMove = createQuery({all: [ cSize, cPosition, cVelocity ]});
const qColour = createQuery({all: [ cColour ]});
const qRender = createQuery({all: [ cSize, cColour, cPosition ], any: [tBorder]});
const qPos = createQuery({all: [ cPosition ]});

// 3. Create a world and destructure functions
const world = createWorld({
  components: [
    cColour,
    cPosition,
    cSize,
    cVelocity,
    tBorder
  ],
  entityCapacity: ENTITIES,
});

// 3b. Expose the world object for debugging (optional)
window.world = world;

// 3c. Decompose functions from the world
const {
  addComponentToEntity,
  removeComponentFromEntity,
  entityHasComponent,
  createEntity,
  destroyEntity,
  refreshWorld
} = world;

// 4. Define Systems
const sColour = (world, delta = 1) => {
  const [entities, components] =  qColour.getResult(world);
  const { colour } = components;
  const { r, g, b } = colour;
  function changeColour(entity) {
    r[entity] = (r[entity] + 1 * delta) % 255;
    g[entity] = (g[entity] + 1 * delta) % 255;
    b[entity] = (b[entity] + 1 * delta) % 255;
  }
  entities.forEach(changeColour);
}

const sMove = (world, delta = 1) => {
  const [entities, components] =  qMove.getResult(world);
  const { position, size, velocity } = components;
  const { x, y } = position;
  const { value } = size;
  const { dx, dy } = velocity;
  function changePosition(entity) {
    // bounce box off sides of canvas
    const ds = value[entity];
    const nx = x[entity] + dx[entity] * delta * SPEED;
    const ny = y[entity] + dy[entity] * delta * SPEED;
    if (nx >= canvas.width - ds || nx <= 0) {
      dx[entity] = -dx[entity];
      addComponentToEntity(tBorder, entity);
    }
    if (ny >= canvas.height - ds || ny <= 0) {
      dy[entity] = -dy[entity];
      removeComponentFromEntity(tBorder, entity);
    }
    // update position
    x[entity] += dx[entity] * delta * SPEED;
    y[entity] += dy[entity] * delta * SPEED;
  }
  entities.forEach(changePosition);
}

const sRender = (world, alpha = 0) => {
  const [entities, components] = qRender.getResult(world);
  const { colour, position, size } = components;
  const { r, g, b } = colour;
  const { x, y } = position;
  const { value } = size;
  ctx.fillStyle = "grey";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  function renderShape(entity) {
    const _x = x[entity];
    const _y = y[entity];
    const _s = value[entity];
    ctx.fillStyle = `rgb(${r[entity]}, ${g[entity]}, ${b[entity]})`;
    ctx.fillRect(_x, _y, _s, _s);
    if (entityHasComponent(tBorder, entity)) {
      ctx.strokeRect(_x, _y, _s, _s);
    }
  }
  entities.forEach(renderShape);
}

// 5. Create Entities and give them some components
for (let i = 0, max = ENTITIES; i < max; i++) {
  const box = createEntity(world);
  addComponentToEntity(cSize, box, { value: rnd(25, 125) });
  addComponentToEntity(cPosition, box, { x: rnd(125, canvas.width - 125), y: rnd(125, canvas.height - 125) });
  addComponentToEntity(cColour, box, { r: rnd(0, 255), g: rnd(0, 255), b: rnd(0, 255) });
  addComponentToEntity(cVelocity, box, { dx: rnd(-10, 10), dy: rnd(-10, 10) });
  if (i % 2) addComponentToEntity(tBorder, box);
}

///////////////////////////
// Demo specific code (not Miski specific)
///////////////////////////
const sFPS = document.getElementById("sFPS");
const sFrame = document.getElementById("sFrame");
const sResX = document.getElementById("sResX");
const sResY = document.getElementById("sResY");
const rSpeed = document.getElementById("rSpeed");

function throttle(callback, limit) {
  var wait = false;
  return function (...args) {
    if (!wait) {
      callback.call(this, ...args);
      wait = true;
      setTimeout(function () {
        wait = false;
      }, limit);
    }
  };
}

rSpeed.addEventListener("input", () => {
  SPEED = rSpeed.value;
}, { passive: true });

let frame = 0;
function updateFrame() {
  sFrame.textContent = frame;
}

let f = 0
let ld = 0;
let lu = Number.NEGATIVE_INFINITY;
function updateFps(time) {
  if (time <= lu + 1000) {
    ld += 1;
    return;
  }
  f =  0.9 * ld * 1000 / (time - lu) + 0.1 * f;
  lu = time;
  ld = 0;
  sFPS.textContent = Math.round(f + 0.6);
}

function handleResize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const { width, height } = canvas;
  sResX.textContent = width;
  sResY.textContent = height;
  const [entities, components] = qPos.getResult(world);
  const { position } = components;
  const { x, y } = position;
  const halfX = Math.floor(width / 2);
  const halfY = Math.floor(height / 2);
  entities.forEach((entity) => {
    const _x = x[entity];
    const _y = y[entity];
    if (_x >= width - 125 || _x <= 0) {
      x[entity] = halfX;
    }
    if (_y >= height - 125|| _y <= 0) {
      y[entity] = halfY;
    }
  });
}
handleResize();
window.addEventListener("resize", handleResize, {passive: true});

const tUpdateFrame =  throttle(updateFrame, 50);

// 6. Define your game loop (not Miski specific)
let stepLastTime = null;
let stepAccumulator = 0;
let stepLastUpdate = 0;

const tempo = 1 / 60;
const maxUpdates = 240;

function step(time) {
  requestAnimationFrame(step);
  frame++;
  if (stepLastTime !== null) {
    stepAccumulator += (time - (stepLastTime || 0)) * 0.001;
    stepLastUpdate = 0;

    refreshWorld(); // runs World maintenance functions

    while (stepAccumulator > tempo) {
      if (stepLastUpdate >= maxUpdates) {
        stepAccumulator = 1;
        break;
      }

      sColour(world, tempo);
      sMove(world, tempo);

      stepAccumulator -= tempo;
      stepLastUpdate++;
    }
  }

  stepLastTime = time;
  const alpha = stepAccumulator / tempo;
  sRender(world, alpha);

  updateFps(time);
  tUpdateFrame();
}
requestAnimationFrame(step);
