// Based on ECSY's "intersecting circles" demo. @see https://github.com/ecsyjs/ecsy/blob/master/site/examples/canvas/
"use strict";

import { createComponent, createQuery, createSystem, createWorld } from "../../dist/miski.min.js";

function random(a, b) {
  return Math.random() * (b - a) + a;
}

// Simulation constants
const TAU = 2 * Math.PI;
const NUM_ELEMENTS = 10;
let SPEED_MULTIPLIER  = 0.2;

// Canvas setup
const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
let canvasWidth = canvas.width = window.innerWidth;
let canvasHeight = canvas.height = window.innerHeight;
let halfX = Math.floor(canvasWidth / 4);
let halfY = Math.floor(canvasHeight / 4);

// Intersection point container
const INTERSECTING = [];

const cPosition = createComponent({ name: "position", schema: { x: Float32Array, y: Float32Array }});
const cSize = createComponent({name: "size", schema: { radius: Uint8Array }});
const cSpeed = createComponent({ name: "speed", schema: { dx: Float32Array, dy: Float32Array }});
const cVelocity = createComponent({ name: "velocity", schema: { vx: Float32Array, vy: Float32Array }});
const tIntersecting = createComponent({ name: "intersecting" });
const qCircle = createQuery({ all: [cPosition, cSize, cSpeed, cVelocity], any: [ tIntersecting ] });

const world = createWorld({
  capacity: NUM_ELEMENTS,
  components: [
    tIntersecting,
    cVelocity,
    cPosition,
    cSize,
    cSpeed,
  ]
});

window.world = world;

const {
  addComponentsToEntity,
  addComponentToEntity,
  createEntity,
  getQueryResult,
  hasComponent,
  refresh,
  removeComponentFromEntity,
} = world;

const mover = (components, entities, delta) => {
  const { position, size, speed, velocity } = components;
  const { x, y } = position;
  const { radius } = size;
  const { dx, dy } = speed;
  const { vx, vy } = velocity;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    // move
    x[entity] += vx[entity] * dx[entity] * delta * SPEED_MULTIPLIER;
    y[entity] += vy[entity] * dy[entity] * delta * SPEED_MULTIPLIER;
    // wrapping
    const r = radius[entity];
    if (x[entity] - r > canvasWidth) {
      x[entity] = 0;
    }  else if (x[entity] + r < 0) {
      x[entity] = canvasWidth;
    }
    if (y[entity] + r < 0) {
      y[entity] = canvasHeight + r
    } else if (y[entity] - r > canvasHeight) {
      y[entity] = -canvasHeight;
    }
  }
};
const sMovable = createSystem(mover, qCircle)(world);

function intersection(circleA, circleB) {
  var a, dx, dy, d, h, rx, ry;
  var x2, y2;

  dx = circleB.x - circleA.x;
  dy = circleB.y - circleA.y;

  d = Math.sqrt(dy * dy + dx * dx);

  if (d > circleA.radius + circleB.radius) {
    return false;
  }
  if (d < Math.abs(circleA.radius - circleB.radius)) {
    return false;
  }

  a =
    (circleA.radius * circleA.radius -
      circleB.radius * circleB.radius +
      d * d) /
    (2.0 * d);

  x2 = circleA.x + (dx * a) / d;
  y2 = circleA.y + (dy * a) / d;

  h = Math.sqrt(circleA.radius * circleA.radius - a * a);

  rx = -dy * (h / d);
  ry = dx * (h / d);

  var xi = x2 + rx;
  var xi_prime = x2 - rx;
  var yi = y2 + ry;
  var yi_prime = y2 - ry;

  return [xi, yi, xi_prime, yi_prime];
}

const hasIntersection = hasComponent(tIntersecting);
const addIntersection = addComponentToEntity(tIntersecting);
const removeIntersection = removeComponentFromEntity(tIntersecting);

const intersect = (components, entities, delta) => {
  const { position, size, speed, velocity } = components;
  const { x, y } = position;
  const { radius } = size;
  const { dx, dy } = speed;
  const { vx, vy } = velocity;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const points = INTERSECTING[entity];
    points.length = 0;
    for (let j = i + 1; j < entities.length; j++) {
      const entityB = entities[j];
      const intersect = intersection(
        {
          x: x[entity],
          y: x[entity],
          radius: radius[entity],
        },
        {
          x: x[entityB],
          y: x[entityB],
          radius: radius[entityB],
        },
      )
      if (intersect) {
        points.push(...intersect);
        addIntersection(entity);
      } else {
        removeIntersection(entity);
      }
    }
  }
}
const sIntersect = createSystem(intersect, qCircle)(world);

const drawCircle = (x, y, radius) => {
  ctx.beginPath();
  ctx.arc(
    x,
    y,
    radius,
    0,
    TAU,
    false
  );
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
}

function fillCircle(x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2, false);
  ctx.fill();
}

function drawLine(a, b, c, d) {
  ctx.beginPath();
  ctx.moveTo(a, b);
  ctx.lineTo(c, d);
  ctx.stroke();
}

const render = (components, entities) => {
  const { position, size } = components;
  const { x, y } = position;
  const { radius } = size;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    drawCircle(x[entity], y[entity], radius[entity]);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff9";
    if (hasIntersection(entity)) {
      const points = INTERSECTING[entity];
      for (let j = 0; j < points.length; j++) {
        const point = points[j];
        ctx.fillStyle = "rgba(255, 255,255, 0.2)";
        fillCircle(point[0], point[1], 8);
        fillCircle(point[2], point[3], 8);
        ctx.fillStyle = "#fff";
        fillCircle(point[0], point[1], 3);
        fillCircle(point[2], point[3], 3);
        drawLine(point[0], point[1], point[2], point[3]);
      }
    }
  }
}
const sRender = createSystem(render, qCircle)(world);

function getRandomVelocity() {
  return {
    vx: random(-20, 20),
    vy: random(-20, 20),
  };
}

function getRandomPosition() {
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * canvasHeight,
  };
}

function getRandomSpeed() {
  return {
    dx: SPEED_MULTIPLIER * (2 * Math.random() - 1),
    dy: SPEED_MULTIPLIER * (2 * Math.random() - 1),
  };
}

function getRandomSize() {
   return {
     radius: random(20, 100),
   };
}

const shapeBuilder = addComponentsToEntity(cPosition, cSize, cSpeed, cVelocity, tIntersecting);
const shapeFactory = () => {
  const shape = createEntity();
  shapeBuilder(shape, {
    velocity: getRandomVelocity(),
    position: getRandomPosition(),
    size: getRandomSize(),
    speed: getRandomSpeed(),
  });
  INTERSECTING[shape] = [];
  return shape;
}
for (let i = 0; i < NUM_ELEMENTS; i++) {
  shapeFactory();
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
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const { width, height } = canvas;
  halfX = Math.floor(width / 4);
  halfY = Math.floor(height / 4);
  sResX.textContent = width;
  sResY.textContent = height;

  const [resizeComponents, getResizeEntities] = getQueryResult(qCircle);
  const { position } = resizeComponents;
  const { x, y } = position;
  getResizeEntities().forEach((entity) => {
    const _x = x[entity];
    const _y = y[entity];
    if (_x >= width - 125 || _x <= 0) x[entity] = halfX;
    if (_y >= height - 125|| _y <= 0) y[entity] = halfY;
  });
}
handleResize();
window.addEventListener("resize", throttle(handleResize, 48), {passive: true});

// 6. Define your game loop (not Miski specific)
let stepLastTime = null;
let stepAccumulator = 0;
let stepLastUpdate = 0;

const tempo = 1 / 60;
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
      sIntersect(tempo);

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
