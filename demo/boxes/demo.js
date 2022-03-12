"use strict";

import { createComponent, createQuery, createSystem, createWorld } from "../../dist/miski.min.js";

// Utility functions
function rnd(a, b) { return Math.random() * (b - a) + a; }

// Simulation constants
const ENTITIES = 64;
let SPEED = 50;

// Canvas setup
const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
let halfX = Math.floor(window.innerWidth / 4);
let halfY = Math.floor(window.innerHeight / 4);
ctx.strokeStyle = "#000";
ctx.lineWidth = 5;

/* 1. Define components
 *
 * Components are reusable data storage definitions.
 * They consist of a name (must be unique), and an optional storage schema.
 * A storage schema is an object where the key is a string and the value is a TypedArrayConstructor.
 * Components without schemas are "tags". As such, a tag has no properties.
 * Tags can be included in queries just like a regular component.
 * Tags and components can be tested for using `world.entityHasComponent(entity, component)`.
 */
const cColour = createComponent({ name: "colour", schema: { r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray }});
const cSize = createComponent({ name: "size", schema: { value: Uint32Array }});
const cVelocity = createComponent({ name: "velocity", schema: { dx: Float32Array, dy: Float32Array }});
// a tag component, with a maximum capacity:
const tBorder = createComponent({ name: "border", maxEntities: ENTITIES / 2 });
// you can set default values for your component properties like so:
const cPosition = createComponent({ name: "position", schema: { x: [Float32Array, halfX], y: [Float32Array, halfY] }});

/* 2. Create a world and destructure functions
 *
 * To create a world you need two things:
 *  i. components: an array of components to register in the world (required)
 * ii. capacity: the maximum number of entities you want to allow in the world (default = 1_000_000)
 *
 * Components cannot be registered after the world has been created.
 * The default maximum number of entities is 1 million but you should set this manually to avoid wasting memory.
 */
const world = createWorld({
  components: [
    cColour,
    cPosition,
    cSize,
    cVelocity,
    tBorder
  ],
  capacity: ENTITIES,
});

// Expose the world object for debugging (optional - don't do this in production!)
window.world = world;

// Functions can be destructured from the world (optional)
const {
  capacity,
  version,
  addComponentToEntity,
  createEntity,
  destroyEntity,
  entityHasComponent,
  getEntityArchetype,
  getQueryResults,
  getQueryEntered,
  getQueryExited,
  getVacancyCount,
  hasEntity,
  purgeCaches,
  refresh,
  removeComponentFromEntity,
} = world;

/* 3. Create queries
 *
 * Queries group objects by components for use in systems
 * Queries can take 3 arrays of components: `all` (AND), `any` (OR), `none` (NOT).
 * You can get the result of a query inside a system by calling `world.getQueryResult(query)`.
 * getQueryResult returns an tuple (array) of [Entity[], Record<string, ComponentInstance]
 * I recommend you destructure it as:
 * `const [entities, components] = world.getQueryResult(query);`
 * Note: the entities array is essentially in a random order (by archetype id) so you may want to sort it yourself.
 */
const qColour = createQuery({all: [ cColour ]});
const qMove = createQuery({all: [ cSize, cPosition, cVelocity ]});
const qPos = createQuery({all: [ cPosition ]});
const qRender = createQuery({all: [ cSize, cPosition ], any: [tBorder]}); // @todo: option to merge queries in advance rather than supply multiple to systems

/* 4. Define Systems
 *
 * Systems are functions of any arity where the first two (2) parameters is always:
 *  i: an object containing the components captured by the system's query/ies (Record<string, ComponentInstance>).
 * ii: an array of entities currently captured by the system's query/ies (Entity[]).
 * For example: `function(component, entities) {...}` or `function(component, entities, ...args)`, etc.
 * Defining systems using `createSystem` isn't necessary but doing so ensures type safety.
 * Systems created using `createSystem` will return whatever your function returns (i.e., ReturnType<T>).
 */
const sColour = createSystem((components, entities, delta = 1) => {
  // Note: the entities array is essentially in a random order (by archetype id) so you may want to sort it yourself.
  const { colour } = components;
  const { r, g, b } = colour;
  function changeColour(entity) {
    r[entity] = (r[entity] + 1 * delta) % 255;
    g[entity] = (g[entity] + 1 * delta) % 255;
    b[entity] = (b[entity] + 1 * delta) % 255;
  }
  entities.forEach(changeColour);
}, qColour)(world);

const sMove = createSystem((components, entities, delta = 1) => {
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
}, qMove)(world);

// Systems can take multiple queries too:
const sRender = createSystem((components, entities, alpha = 0) => {
  entities.sort((a, b) => a - b);
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
    if (entityHasComponent(entity, tBorder)) {
      ctx.strokeRect(_x, _y, _s, _s);
    }
  }
  entities.forEach(renderShape);
}, qColour, qRender)(world);

/* 5. Create Entities and give them some components */
for (let i = 0, max = ENTITIES; i < max; i++) {
  // An entity is just an integer
  const box = createEntity(world);
  /*
   * Adding components to an entity takes an optional third parameter
   * which defines the entity's initial component property values
   */
  addComponentToEntity(cPosition, box);
  // you can set initial values for the entity's properties like so:
  addComponentToEntity(cSize, box, { value: rnd(25, 125) });
  addComponentToEntity(cColour, box, { r: rnd(0, 255), g: rnd(0, 255), b: rnd(0, 255) });
  addComponentToEntity(cVelocity, box, { dx: rnd(-10, 10), dy: rnd(-10, 10) });
  /**
   * adding tag components is the same, but the third parameter
   * should not be provided (it will be ignored)
   */
  if (i % 3) {
    // since `tBorder` has a maxEntities property, adding component may not be possible
    const tagWasAdded = addComponentToEntity(tBorder, box);
    if (!tagWasAdded) console.log(`Tag was not added to entity ${i} because component was at capacity.`);
  }
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
  SPEED = rSpeed.value;
}, { passive: true });

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
  canvas.width = window.innerWidth / 2;
  canvas.height = window.innerHeight / 2;
  const { width, height } = canvas;
  halfX = Math.floor(width / 2);
  halfY = Math.floor(height / 2);
  sResX.textContent = width;
  sResY.textContent = height;

  const [getResizeEntities, resizeComponents] = world.getQueryResult(qPos);
  const { position } = resizeComponents;
  const { x, y } = position;
  getResizeEntities().forEach((entity) => {
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
window.addEventListener("resize", throttle(handleResize, 32), {passive: true});

// 6. Define your game loop (not Miski specific)
let stepLastTime = null;
let stepAccumulator = 0;
let stepLastUpdate = 0;

const tempo = 1 / 60;
const maxUpdates = 240;

function step(time) {
  requestAnimationFrame(step);
  if (stepLastTime !== null) {
    stepAccumulator += (time - (stepLastTime || 0)) * 0.001;
    stepLastUpdate = 0;

    // runs World maintenance functions
    // I recommend calling this once per frame
    refresh();

    while (stepAccumulator > tempo) {
      if (stepLastUpdate >= maxUpdates) {
        stepAccumulator = 1;
        break;
      }

      // call your systems just like regular functions
      sColour(tempo);
      sMove(tempo);

      stepAccumulator -= tempo;
      stepLastUpdate++;
    }
  }

  stepLastTime = time;
  const alpha = stepAccumulator / tempo;
  // call your systems just like regular functions
  sRender(alpha);

  updateFps(time);
}
requestAnimationFrame(step);
