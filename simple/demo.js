// based on ECSY's canvas demo - https://github.com/ecsyjs/ecsy/blob/dev/site/examples/canvas/
"use strict";

import { createComponent, createWorld, Types } from "../miski.min.js";
import { fillCircle, drawLine, intersection, random } from "./utils.js";

const WIDTH = 1280;
const HEIGHT = 720;
const ENTITIES = 32;
const SPEED_MULTI = 1;

const world = createWorld({
  maxComponents: 32,
  maxEntities: ENTITIES,
});
window.world = world; // for debug purposes, don't do this in production

// COMPONENTS

// define the component
const Position = createComponent({
  name: "Position",
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
});
// register the component to get the component instance
const cPosition = world.registerComponent(Position);

const Velocity = createComponent({
  name: "Velocity",
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
});
const cVelocity = world.registerComponent(Velocity);

const Acceleration = createComponent({
  name: "Acceleration",
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
});
const cAcceleration = world.registerComponent(Acceleration);

const Circle = createComponent({
  name: "Circle",
  schema: {
    radius: Types.i8,
  },
});
const cCircle = world.registerComponent(Circle);

const Intersecting = createComponent({
  name: "Intersecting",
  schema: {
    points: Types.Array,
  },
});
const cIntersecting = world.registerComponent(Intersecting);
window.intersecting = cIntersecting;

// CANVAS SETUP

const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d', {alpha: false});
canvas.width = WIDTH;
canvas.height = HEIGHT;
ctx.imageSmoothingEnabled = ctx.mozImageSmoothingEnabled = ctx.webkitImageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";
ctx.fillStyle = "black";

// QUERIES

const qMovement = world.registerQuery({ name: "movement", all: [cAcceleration, cCircle, cPosition, cVelocity] });
const qCircle = world.registerQuery({ name: "circle", all: [cCircle, cPosition, cIntersecting]});

// SYSTEMS - registration order = execution order! (can be changed later with world.moveSystem(system, position))

const sMovement = world.registerSystem({
  name: "Movement",
  query: qMovement,
  update: (entities, dt) => {
    const pos = cPosition;
    const acc = cAcceleration;
    const vel = cVelocity;
    const rad = cCircle.radius;

    entities.forEach((entity) => {
      pos.x[entity] += vel.x[entity] * acc.x[entity] * dt * SPEED_MULTI ;
      pos.y[entity] += vel.y[entity] * acc.y[entity] * dt * SPEED_MULTI ;

      if (acc.x[entity] > 1) acc.x[entity] -= dt * SPEED_MULTI;
      if (acc.y[entity] > 1) acc.y[entity] -= dt * SPEED_MULTI;
      if (acc.x[entity] < 1) acc.x[entity] = 1;
      if (acc.y[entity] < 1) acc.y[entity] = 1;

      const radius = rad[entity][0];
      if ((pos.y[entity] + radius) < 0) pos.y[entity] = canvas.height + radius;
      if ((pos.y[entity] - radius) > canvas.height) pos.y[entity] = -radius;
      if ((pos.x[entity] - radius) > canvas.width) pos.x[entity] = 0;
      if ((pos.x[entity] + radius) < 0) pos.x[entity] = canvas.width;
    });
  },
});
sMovement.enable();

const sCircle = world.registerSystem({
  name: "Circle",
  query: qCircle,
  pre: () => {
    cIntersecting.points.forEach((_, idx, arr) => arr[idx].length = 0);
  },
  update: (entities) => {
    const pos = cPosition;
    const rad = cCircle.radius;
    const int = cIntersecting.points;

    entities.forEach((entity, idx) => {
      for (let j = idx + 1; j < entities.length; j++) {
        const entityB = entities[j];
        const intersect = intersection(
          [pos.x[entity], pos.y[entity], rad[entity]],
          [pos.x[entityB], pos.y[entityB], rad[entityB]],
        );
        if (intersect !== false) {
          int[entity].push(intersect);
        }
      }
    });
  },
  post: (entities) => {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pos = cPosition;
    const rad = cCircle.radius;
    const int = cIntersecting.points;

    entities.forEach((entity) => {
      ctx.beginPath();
      ctx.arc(
        pos.x[entity], // x
        pos.y[entity], // y
        rad[entity], // radius
        0,
        2 * Math.PI,
        false
      );
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#fff";
      ctx.stroke();

      const intersect = int[entity];
      ctx.strokeStyle = "#ff9";
      ctx.lineWidth = 2;
      ctx.fillStyle = "#fff";
      for (let j = 0; j < intersect.length; j++) {
        const points = intersect[j];
        fillCircle(ctx, points[0], points[1], 3);
        fillCircle(ctx, points[2], points[3], 3);
        drawLine(ctx, points[0], points[1], points[2], points[3]);
      }
    });
  },
});
sCircle.enable();

// SETUP

for (let i = 0; i < ENTITIES; i++) {
  const entity = world.createEntity();
  world.addComponentToEntity(entity, cCircle, {radius: random(20, 100)});
  world.addComponentToEntity(entity, cIntersecting);
  world.addComponentToEntity(entity, cAcceleration);
  world.addComponentToEntity(entity, cPosition, {
    x: random(0, canvas.width),
    y: random(0, canvas.height),
  });
  world.addComponentToEntity(entity, cVelocity, {
    x: random(-20, 20),
    y: random(-20, 20),
  });
}

function resize() {
  canvas.width = canvas.width = window.innerWidth;
  canvas.height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize, {passive: true});
resize();

// FPS counter
let f = 0
let ld = 0;
let lu = Number.NEGATIVE_INFINITY;
const sFPS = document.getElementById('fps');
function updateFPS(time) {
  if (time <= lu + 1000) {
    ld += 1;
    return;
  }
  f =  0.9 * ld * 1000 / (time - lu) + 0.1 * f;
  lu = time;
  ld = 0;
  sFPS.textContent = Math.round(f + 0.6);
}

// game loop
function onTick(time) {
  window.requestAnimationFrame(onTick);
  world.step(time);
  updateFPS(time);
}
onTick(0);
