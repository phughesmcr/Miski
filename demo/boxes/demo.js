// Based on ECSY's "circles and boxes" demo. @see https://github.com/ecsyjs/ecsy/blob/master/site/examples/circles-boxes/index.html
"use strict";

import { Component, Query, System, World } from "../../dist/miski.min.js";

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

function getRandomPosition(w, h) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
  };
}

function getRandomShape() {
   return {
     primitive: Math.random() >= 0.5 ? 1 : 0,
   };
}

const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const bRender = document.getElementById("bRender");
const sEnts = document.getElementById("sEnts");
const updateEntityCount = () => sEnts.textContent = NUM_ELEMENTS.toString();

// Simulation constants
const ENTITIES = [];
const PRIMITIVES = { 0: "box", 1: "circle" };
const TAU = 2 * Math.PI;
const SHAPE_SIZE = 20;
const SHAPE_HALF_SIZE = SHAPE_SIZE / 2;
const MAX_CAPACITY = 5000;
let INIT_ELEMENTS = 10;
let NUM_ELEMENTS = 0;
let SPEED_MULTIPLIER = 1;

/* 1. Define components
 *
 * Components are reusable data storage definitions.
 * They consist of a name (must be unique), and an optional storage schema.
 * A storage schema is an object where the key is a string and the value is a TypedArrayConstructor.
 * Components without schemas are "tags". As such, a tag has no properties.
 * Tags can be included in queries just like a regular component.
 * Tags and components can be tested for using `world.entityHasComponent(entity, component)`.
 */
const cPosition = new Component({ name: "position", schema: { x: Float64Array, y: Float64Array }});
const cShape = new Component({ name: "shape", schema: { primitive: Uint8Array }});
const cVelocity = new Component({ name: "velocity", schema: { vx: Float64Array, vy: Float64Array }});
// a tag component:
const tRenderable = new Component({ name: "renderable" });

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
const qMovable = new Query({ all: [cPosition, cVelocity] });
const qRenderable = new Query({ all: [cPosition, cShape, tRenderable] });

/* 3. Create a world and destructure functions
 *
 * To create a world you need two things:
 *  i. components: an array of components to register in the world (required)
 * ii. capacity: the maximum number of entities you want to allow in the world (default = 1_000_000)
 *
 * Components cannot be registered after the world has been created.
 * The default maximum number of entities is 1 million but you should set this manually to avoid wasting memory.
 */
const world = new World({
  capacity: MAX_CAPACITY,
  components: [
    cPosition,
    cShape,
    cVelocity,
    tRenderable,
  ]
});

// Expose the world object for debugging (optional - don't do this in production!)
window.world = world;

/* 4. Define Systems
 *
 * Systems are functions of any arity where the first two (2) parameters is always:
 *  i: an object containing the components captured by the system's query/ies (Record<string, ComponentInstance>).
 * ii: an array of entities currently captured by the system's query/ies (Entity[]).
 * For example: `function(component, entities) {...}` or `function(component, entities, ...args)`, etc.
 * Defining systems using `createSystem` isn't necessary but doing so ensures type safety.
 * Systems created using `createSystem` will return whatever your function returns (i.e., ReturnType<T>).
 */

const prevX = new Array(MAX_CAPACITY).fill(0);
const prevY = new Array(MAX_CAPACITY).fill(0);

const sMovable = new System({ query: qMovable, system: (components, entities, delta, ctx) => {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const { position, velocity } = components;
  const { x, y } = position;
  const { vx, vy } = velocity;
  for (let entity of entities) {
    prevX[entity] = x[entity];
    prevY[entity] = y[entity];
    x[entity] += vx[entity] * SPEED_MULTIPLIER;
    y[entity] += vy[entity] * SPEED_MULTIPLIER;
    // wrapping
    if (x[entity] > width) x[entity] = -SHAPE_SIZE;
    if (x[entity] < -SHAPE_SIZE) x[entity] = width + SHAPE_SIZE;
    if (y[entity] > height) y[entity] = -SHAPE_SIZE;
    if (y[entity] < -SHAPE_SIZE) y[entity] = height + SHAPE_SIZE;
  }
}});

const drawBox = (x, y, ctx) => {
  ctx.fillStyle = "#888";
  ctx.beginPath();
  ctx.arc(x, y, SHAPE_HALF_SIZE, 0, TAU, false);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#222";
  ctx.stroke();
}

const drawCircle = (x, y, ctx) => {
  ctx.beginPath();
  ctx.rect(x - SHAPE_HALF_SIZE, y - SHAPE_HALF_SIZE, SHAPE_SIZE, SHAPE_SIZE);
  ctx.fillStyle= "#f28d89";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#800904";
  ctx.stroke();
}

const render = (components, entities, alpha, ctx) => {
  const { position, shape } = components;
  const { x, y } = position;
  const { primitive } = shape;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let entity of entities) {
    const dx = (prevX[entity]) ? (x[entity] - prevX[entity]) * alpha + prevX[entity] : x[entity];
    const dy = (prevY[entity]) ? (y[entity] - prevY[entity]) * alpha + prevY[entity] : y[entity];
    (PRIMITIVES[primitive[entity]] === "box") ? drawBox(dx, dy, ctx) : drawCircle(dx, dy, ctx);
  }
}
const sRender = new System({ system: render, query: qRenderable });

// You can define a prefab like so:
const shapeBuilder = world.addComponentsToEntity(cVelocity, cPosition, cShape, tRenderable);

/* 5. Create Entities and give them some components */
const createShapes = (n, w = ctx.width, h = ctx.height) => {
  for (let i = 0; i < n; i++) {
    const shape = world.createEntity(); // this is the only Miski specific bit
    if (shape !== undefined) {
      NUM_ELEMENTS++;
      shapeBuilder(shape, {
        position: getRandomPosition(w, h),
        shape: getRandomShape(),
        velocity: getRandomVelocity(),
      });
      ENTITIES.push(shape);
    } else {
      console.warn("NO MORE ENTITIES LEFT!");
    }
  }
  updateEntityCount();
}

const destroyShapes = (n) => {
  for (let i = 0; i < n; i++) {
    const e = ENTITIES.pop();
    if (e !== undefined) {
      NUM_ELEMENTS--;
      world.destroyEntity(e);  // this is the only Miski specific bit
    }
  }
  updateEntityCount();
}

window.addEventListener("DOMContentLoaded", () => {
  const sFPS = document.getElementById("sFPS");
  const sResX = document.getElementById("sResX");
  const sResY = document.getElementById("sResY");
  const rSpeed = document.getElementById("rSpeed");
  const bAdd = document.getElementById("add");
  const bSub = document.getElementById("subtract");
  const bAddBig = document.getElementById("addBig");
  const bSubBig = document.getElementById("subtractBig");

  bAdd.addEventListener("click", () => { createShapes(10); });
  bSub.addEventListener("click", () => { destroyShapes(10); });
  bAddBig.addEventListener("click", () => { createShapes(100); });
  bSubBig.addEventListener("click", () => { destroyShapes(100); })
  rSpeed.addEventListener("input", () => { SPEED_MULTIPLIER = rSpeed.value; }, { passive: true });
  SPEED_MULTIPLIER = rSpeed.value;

  const resize = () => {
    const { devicePixelRatio = 2, innerHeight, innerWidth } = window;
    canvas.width = innerWidth; //* devicePixelRatio;
    canvas.height = innerHeight //* devicePixelRatio;
    canvas.style.width = innerWidth;
    canvas.style.height = innerHeight;
    // ctx.scale(devicePixelRatio, devicePixelRatio);
    sResX.textContent = canvas.width;
    sResY.textContent = canvas.height;
  }

  const fps = 60;
  const frameDuration = 1000 / fps;
  let lag = 0;
  let previous = 0;
  let startTime = null;

  const start = (time) => {
    if (startTime === null) startTime = time;
    requestAnimationFrame(start);
    let delta = time - previous;
    if (delta > 1000) delta = frameDuration;
    lag += delta;
    if (lag >= frameDuration) {
      // call your systems just like regular functions
      sMovable.exec(world, delta, ctx);
      lag -= frameDuration;
    }
    const alpha = lag / frameDuration;
    // call your systems just like regular functions
    if (bRender.checked) sRender.exec(world, alpha, ctx);

    previous = time;

    // runs World maintenance functions
    // I recommend calling this once per frame
    world.refresh();
  };

  window.addEventListener("resize", resize, {passive: true});
  resize();
  createShapes(INIT_ELEMENTS, canvas.width, canvas.height);
  updateEntityCount();
  requestAnimationFrame(start);
}, false);
