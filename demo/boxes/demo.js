// Based on ECSY's "circles and boxes" demo. @see https://github.com/ecsyjs/ecsy/blob/master/site/examples/circles-boxes/index.html
"use strict";

import { Component, Query, System, World } from "../../dist/miski.min.js";

// Utility functions
const sEnts = document.getElementById("sEnts");
const updateEntityCount = () => sEnts.textContent = NUM_ELEMENTS.toString();
const rnd = (a, b) => Math.random() * (b - a) + a;
const getRandomVelocity = () => ({ vx: rnd(-2, 2), vy: rnd(-2, 2) });
const getRandomPosition = (w, h) => ({ x: Math.random() * w, y: Math.random() * h });
const getRandomShape = () => ({ primitive: Math.random() >= 0.5 ? 1 : 0 }); // 0 = box, 1 = circle
const intersectRect = (r1, r2) => !(r2.left > r1.right || r2.right < r1.left || r2.top > r1.bottom || r2.bottom < r1.top);
/** @param {MouseEvent} event */
const getMousePosition = (event) => {
  const { left, top } = canvas.getBoundingClientRect();
  return {
    mx: (event.clientX - left),
    my: (event.clientY - top),
  }
}

// Simulation constants
const ENTITIES = [];
const TAU = 2 * Math.PI;
const SHAPE_SIZE = 20;
const SHAPE_HALF_SIZE = SHAPE_SIZE / 2;
const MAX_CAPACITY = 5000;
const INIT_ELEMENTS = 600;
let NUM_ELEMENTS = 0;
let SPEED_MULTIPLIER = 0.1;

// Canvas
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

/* 1. Define components
 *
 * Components are reusable data storage definitions.
 * They consist of a name (must be unique), and an optional storage schema.
 * A storage schema is an object where the key is a string and the value is a TypedArrayConstructor.
 * Components without schemas are "tags". As such, a tag has no properties.
 * Tags can be included in queries just like a regular component.
 * Tags and components can be tested for using `world.entityHasComponent(entity, component)`.
 */
const cPosition = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array }});
const cShape = new Component({ name: "shape", schema: { primitive: Uint8Array }});
const cVelocity = new Component({ name: "velocity", schema: { vx: Float32Array, vy: Float32Array }});
// a tag component:
const tRenderable = new Component({ name: "renderable" });
const tClicked = new Component({ name: "clicked" });

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
 *  i. components: an array of components to register in the world
 * ii. capacity: the maximum number of entities you want to allow in the world
 *
 * Components cannot be registered after the world has been created.
 */
const world = new World({
  capacity: MAX_CAPACITY,
  components: [
    cPosition,
    cShape,
    cVelocity,
    tRenderable,
    tClicked,
  ]
});

// Expose the world object for debugging (don't do this in production!)
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
const sMovable = new System({ query: qMovable, system: (components, entities, delta) => {
  const { width, height } = canvas;
  const { position, velocity } = components;
  const { x, y } = position;
  const { vx, vy } = velocity;
  for (let entity of entities) {
    x[entity] += vx[entity] * delta * SPEED_MULTIPLIER;
    y[entity] += vy[entity] * delta * SPEED_MULTIPLIER;
    if (x[entity] > width + SHAPE_HALF_SIZE) {
      x[entity] = -SHAPE_HALF_SIZE;
    } else if (x[entity] < -SHAPE_HALF_SIZE) {
      x[entity] = width + SHAPE_HALF_SIZE;
    }
    if (y[entity] > height + SHAPE_HALF_SIZE) {
      y[entity] = -SHAPE_HALF_SIZE;
    } else if (y[entity] < -SHAPE_HALF_SIZE) {
      y[entity] = height + SHAPE_HALF_SIZE;
    }
  }
}}).init(world);

const drawCircle = (x, y) => {
  ctx.fillStyle = "#888";
  ctx.beginPath();
  ctx.arc(x, y, SHAPE_HALF_SIZE, 0, TAU, false);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#222";
  ctx.stroke();
}

const drawBox = (x, y) => {
  ctx.beginPath();
  ctx.rect(x - SHAPE_HALF_SIZE, y - SHAPE_HALF_SIZE, SHAPE_SIZE, SHAPE_SIZE);
  ctx.fillStyle= "#f28d89";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#800904";
  ctx.stroke();
}

const drawSpecial = (x, y) => {
  ctx.save();
  ctx.fillStyle= "yellow";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "black";
  ctx.beginPath();
  ctx.translate(x, y);
  ctx.moveTo(0, 0 - 5);
  for (let i = 0; i < 5; i++) {
    const t = Math.PI / 5;
    ctx.rotate(t);
    ctx.lineTo(0, 0 - (5 * 5));
    ctx.rotate(t);
    ctx.lineTo(0, 0 - 5);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const sRender = new System({ query: qRenderable, system: (components, entities, alpha) => {
  const { position, shape } = components;
  const { x, y } = position;
  const { primitive } = shape;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let entity of entities) {
    if (primitive[entity] === 0) {
      drawBox(x[entity], y[entity]);
    } else if (primitive[entity] === 1) {
      drawCircle(x[entity], y[entity]);
    } else {
      drawSpecial(x[entity], y[entity]);
    }
  }
}}).init(world);

// You can define a prefab factory like so:
const shapeBuilder = world.addComponentsToEntity(cVelocity, cPosition, cShape, tRenderable);

/* 5. Create Entities and give them some components */
const createShapes = (n, w = canvas.width, h = canvas.height) => {
  for (let i = 0; i < n; i++) {
    const entity = world.createEntity(); // this is the only Miski specific bit
    if (entity !== undefined) {
      NUM_ELEMENTS++;
      shapeBuilder(entity, {
        position: getRandomPosition(w, h),
        shape: getRandomShape(),
        velocity: getRandomVelocity(),
      });
      ENTITIES.push(entity);
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
  const sResX = document.getElementById("sResX");
  const sResY = document.getElementById("sResY");
  const rSpeed = document.getElementById("rSpeed");
  const bAdd = document.getElementById("add");
  const bSub = document.getElementById("subtract");
  const bAddBig = document.getElementById("addBig");
  const bSubBig = document.getElementById("subtractBig");
  const bRender = document.getElementById("bRender");

  bAdd.addEventListener("click", () => { createShapes(10); }, { passive: true });
  bSub.addEventListener("click", () => { destroyShapes(10); }, { passive: true });
  bAddBig.addEventListener("click", () => { createShapes(100); }, { passive: true });
  bSubBig.addEventListener("click", () => { destroyShapes(100); }, { passive: true });

  rSpeed.addEventListener("input", () => { SPEED_MULTIPLIER = rSpeed.value; }, { passive: true });
  SPEED_MULTIPLIER = rSpeed.value;

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    const { mx, my } = getMousePosition(event);
    const r1 = {
      top: my,
      right: mx + SHAPE_SIZE,
      bottom: my + SHAPE_SIZE,
      left: mx,
    };
    const { position, shape } = world.getQueryComponents(qRenderable);
    const { x, y } = position;
    const { primitive } = shape;
    const entities = world.getQueryEntities(qRenderable);
    for (const entity of entities) {
      const r2 = {
        top: y[entity],
        right: x[entity] + SHAPE_SIZE,
        bottom: y[entity] + SHAPE_SIZE,
        left: x[entity],
      };
      if (intersectRect(r1, r2)) {
        primitive[entity] = 3;
        world.addComponentsToEntity(tClicked)(entity);
        console.log("clicked on entity " + entity);
        break;
      }
    }
  }
  canvas.addEventListener("mousedown", onClick, { passive: true });

  const resize = () => {
    const { devicePixelRatio = 1 } = window;
    const { clientHeight, clientWidth } = document.documentElement;
    canvas.width = clientWidth * devicePixelRatio;
    canvas.height = clientHeight * devicePixelRatio;
    canvas.style.width = clientWidth + "px";
    canvas.style.height = clientHeight + "px";
    ctx.scale(devicePixelRatio, devicePixelRatio)
    sResX.textContent = canvas.width;
    sResY.textContent = canvas.height;
  }

  const fps = 60;
  const frameDuration = 1000 / fps;
  let lag = 0;
  let previous;

  const start = (time) => {
    requestAnimationFrame(start);
    let delta = time - previous;
    previous = time;
    if (delta > fps) delta = frameDuration;
    lag += delta;
    let updated = false;
    while (lag >= frameDuration) {
      // call your systems just like regular functions
      sMovable(delta);
      lag -= frameDuration;
      updated = true;
    }
    if (updated) {
      if (bRender.checked) sRender(lag / frameDuration);
    }
    // runs World maintenance functions
    // I recommend calling this once per frame
    world.refresh();
  };

  resize();
  window.addEventListener("resize", resize, {passive: true});
  createShapes(INIT_ELEMENTS);
  updateEntityCount();

  previous = performance.now();
  requestAnimationFrame(start);
}, { passive: true, once: true });
