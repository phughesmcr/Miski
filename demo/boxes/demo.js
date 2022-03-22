// Based on ECSY's "circles and boxes" demo. @see https://github.com/ecsyjs/ecsy/blob/master/site/examples/circles-boxes/index.html
"use strict";

import { createComponent, createQuery, createSystem, createWorld } from "../../dist/miski.min.js";

// Utility functions
function rnd(a, b) {
  return Math.random() * (b - a) + a;
}

function getRandomVelocity() {
  return {
    vx: rnd(-2, 2),
    vy: rnd(-2, 2),
  };
}

function getRandomPosition() {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight,
  };
}

function getRandomShape() {
   return {
     primitive: Math.random() >= 0.5 ? 1 : 0,
   };
}

// Simulation constants
const PRIMITIVES = { 0: "box", 1: "circle" };
const TAU = 2 * Math.PI;
const NUM_ELEMENTS = 600;
const SHAPE_SIZE = 20;
const SHAPE_HALF_SIZE = SHAPE_SIZE / 2;
let SPEED_MULTIPLIER  = 3;

// Canvas setup
const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
let canvasWidth = canvas.width = window.innerWidth;
let canvasHeight = canvas.height = window.innerHeight;
let halfX = canvasWidth / 2;
let halfY = canvasHeight / 2;

/* 1. Define components
 *
 * Components are reusable data storage definitions.
 * They consist of a name (must be unique), and an optional storage schema.
 * A storage schema is an object where the key is a string and the value is a TypedArrayConstructor.
 * Components without schemas are "tags". As such, a tag has no properties.
 * Tags can be included in queries just like a regular component.
 * Tags and components can be tested for using `world.entityHasComponent(entity, component)`.
 */
const cPosition = createComponent({ name: "position", schema: { x: Float64Array, y: Float64Array }});
const cShape = createComponent({ name: "shape", schema: { primitive: Uint8Array }});
const cVelocity = createComponent({ name: "velocity", schema: { vx: Float64Array, vy: Float64Array }});
// a tag component:
const tRenderable = createComponent({ name: "renderable" });

/* 2. Create queries
 *
 * Queries group objects by components for use in systems
 * Queries can take 3 arrays of components: `all` (AND), `any` (OR), `none` (NOT).
 * You can get the result of a query inside a system by calling `world.getQueryResult(query)`.
 * getQueryResult returns an tuple (array) of [Record<string, ComponentInstance, Entity[]]
 * I recommend you destructure it as:
 * `const [components, entities] = world.getQueryResult(query);`
 * Note: the entities array is essentially in a random order (by archetype id) so you may want to sort it yourself.
 */
const qMovable = createQuery({ all: [cPosition, cVelocity] });
const qRenderable = createQuery({ all: [cPosition, cShape, tRenderable] });

/* 3. Create a world and destructure functions
 *
 * To create a world you need two things:
 *  i. components: an array of components to register in the world (required)
 * ii. capacity: the maximum number of entities you want to allow in the world (default = 1_000_000)
 *
 * Components cannot be registered after the world has been created.
 * The default maximum number of entities is 1 million but you should set this manually to avoid wasting memory.
 */
const world = createWorld({
  capacity: NUM_ELEMENTS,
  components: [
    cPosition,
    cShape,
    cVelocity,
    tRenderable,
  ]
});

// Expose the world object for debugging (optional - don't do this in production!)
window.world = world;

// Functions can be destructured from the world (optional)
const {
  addComponentsToEntity,
  createEntity,
  getQueryResult,
  refresh,
} = world;

/* 4. Define Systems
 *
 * Systems are functions of any arity where the first two (2) parameters is always:
 *  i: an object containing the components captured by the system's query/ies (Record<string, ComponentInstance>).
 * ii: an array of entities currently captured by the system's query/ies (Entity[]).
 * For example: `function(component, entities) {...}` or `function(component, entities, ...args)`, etc.
 * Defining systems using `createSystem` isn't necessary but doing so ensures type safety.
 * Systems created using `createSystem` will return whatever your function returns (i.e., ReturnType<T>).
 */
const mover = (components, entities, delta) => {
  const { position, velocity } = components;
  const { x, y } = position;
  const { vx, vy } = velocity;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    x[entity] += vx[entity] * SPEED_MULTIPLIER * delta;
    y[entity] += vy[entity] * SPEED_MULTIPLIER * delta;
    if (x[entity] > canvasWidth + SHAPE_HALF_SIZE) x[entity] = -SHAPE_HALF_SIZE;
    if (x[entity] < -SHAPE_HALF_SIZE) x[entity] = canvasWidth + SHAPE_HALF_SIZE;
    if (y[entity] > canvasHeight + SHAPE_HALF_SIZE) y[entity] = -SHAPE_HALF_SIZE;
    if (y[entity] < -SHAPE_HALF_SIZE) y[entity] = canvasHeight + SHAPE_HALF_SIZE;
  }
};
const sMovable = createSystem(mover, qMovable)(world);

const drawBox = (x, y) => {
  ctx.fillStyle = "#888";
  ctx.beginPath();
  ctx.arc(x, y, SHAPE_HALF_SIZE, 0, TAU, false);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#222";
  ctx.stroke();
}

const drawCircle = (x, y) => {
  ctx.beginPath();
  ctx.rect(x - SHAPE_HALF_SIZE, y - SHAPE_HALF_SIZE, SHAPE_SIZE, SHAPE_SIZE);
  ctx.fillStyle= "#f28d89";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#800904";
  ctx.stroke();
}

const render = (components, entities,) => {
  const { position, shape } = components;
  const { x, y } = position;
  const { primitive } = shape;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const prim = PRIMITIVES[primitive[entity]] ?? 0;
    (prim === "box") ? drawBox(x[entity], y[entity]) : drawCircle(x[entity], y[entity]);
  }
}
const sRender = createSystem(render, qRenderable)(world);

// You can define a prefab like so:
const shapeBuilder = addComponentsToEntity(cVelocity, cPosition, cShape, tRenderable);

/* 5. Create Entities and give them some components */
for (let i = 0; i < NUM_ELEMENTS; i++) {
  const shape = createEntity();
  shapeBuilder(shape, {
    position: getRandomPosition(),
    shape: getRandomShape(),
    velocity: getRandomVelocity(),
  });
}

///////////////////////////
// Demo specific code (not Miski specific)
///////////////////////////
const sFPS = document.getElementById("sFPS");
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
  SPEED_MULTIPLIER = rSpeed.value;
}, { passive: true });
SPEED_MULTIPLIER = rSpeed.value;

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
  canvasWidth = canvas.width =  window.innerWidth;
  canvasHeight = canvas.height =  window.innerHeight;
  halfX = canvasWidth / 2;
  halfY = canvasHeight / 2;
  sResX.textContent = canvasWidth;
  sResY.textContent = canvasHeight;

  const [resizeComponents, getResizeEntities] = getQueryResult(qMovable);
  const { position } = resizeComponents;
  const { x, y } = position;
  getResizeEntities().forEach((entity) => {
    const _x = x[entity];
    const _y = y[entity];
    if (_x >= canvasWidth - 125 || _x <= 0) x[entity] = halfX;
    if (_y >= canvasHeight - 125|| _y <= 0) y[entity] = halfY;
  });
}
handleResize();
window.addEventListener("resize", throttle(handleResize, 48), {passive: true});

// 6. Define your game loop (not Miski specific)
let stepLastTime = null;
let stepAccumulator = 0;
let stepLastUpdate = 0;

const tempo = 1 / 120;
const maxUpdates = 240;

function step(time) {
  requestAnimationFrame(step);
  if (stepLastTime !== null) {
    stepAccumulator += (time - (stepLastTime ?? 0)) * 0.001;
    stepLastUpdate = 0;

    while (stepAccumulator > tempo) {
      if (stepLastUpdate >= maxUpdates) {
        stepAccumulator = 1;
        break;
      }

      // call your systems just like regular functions
      sMovable(tempo);

      stepAccumulator -= tempo;
      stepLastUpdate++;
    }
  }

  stepLastTime = time;
  const alpha = stepAccumulator / tempo;
  // call your systems just like regular functions
  sRender(alpha);

  updateFps(time);

  // runs World maintenance functions
  // I recommend calling this once per frame
  refresh();
}
requestAnimationFrame(step);
