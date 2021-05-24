// based on ECSY's canvas demo - https://github.com/ecsyjs/ecsy/blob/dev/site/examples/canvas/
"use strict";

import { createWorld } from "./miski.min.js";
import { fillCircle, drawLine, intersection, random } from "./utils.js";

const WIDTH = 1920;
const HEIGHT = 1080;

const world = createWorld();
window.world = world;

// COMPONENTS

const cPosition = world.registerComponent({
  name: "Position",
  defaults: {
    x: 0,
    y: 0,
  },
});

const cVelocity = world.registerComponent({
  name: "Velocity",
  defaults: {
    x: 0,
    y: 0,
  },
});

const cAcceleration = world.registerComponent({
  name: "Acceleration",
  defaults: {
    x: 0,
    y: 0,
  },
});

const cCircle = world.registerComponent({
  name: "Circle",
  defaults: {
    radius: 10,
  },
});

const cIntersecting = world.registerComponent({
  name: "Intersecting",
  defaults: {
    points: [],
  },
});

const cCanvasContext = world.registerComponent({
  name: "Canvas",
  defaults: {
    ctx: undefined,
    width: 1920,
    height: 1080,
  },
});

const cBufferContext = world.registerComponent({
  name: "Buffer",
  defaults: {
    ctx: undefined,
    width: WIDTH,
    height: HEIGHT,
  },
});

const cDemoSettings = world.registerComponent({
  name: "Demo",
  defaults: {
    speedMultiplier: 1,
  },
});

// CANVAS SETUP

// global entity (i.e. singleton) - available in all systems
world.global.addComponent(cCanvasContext);
world.global.addComponent(cBufferContext);
world.global.addComponent(cDemoSettings);
world.global.enable();

// canvas
const cnv = document.getElementsByTagName('canvas')[0];
cnv.width = window.innerWidth;
cnv.height = window.innerHeight;

const globalCanvas = world.global.Canvas;
globalCanvas.ctx = cnv.getContext('2d', {alpha: false});
globalCanvas.width = cnv.width;
globalCanvas.height = cnv.height;
globalCanvas.ctx.imageSmoothingEnabled = globalCanvas.ctx.mozImageSmoothingEnabled = globalCanvas.ctx.webkitImageSmoothingEnabled = true;
globalCanvas.ctx.imageSmoothingQuality = "high";
globalCanvas.ctx.fillStyle = "black";

// buffer
const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = WIDTH;
bufferCanvas.height = HEIGHT;

const globalBuffer = world.global.Buffer;
globalBuffer.ctx = bufferCanvas.getContext('2d', {alpha: false, desynchronized: true});
globalBuffer.width = bufferCanvas.width;
globalBuffer.height = bufferCanvas.height;

// QUERIES

const qMovement = world.registerQuery({ all: [cAcceleration, cCircle, cPosition, cVelocity] });
const qCircle = world.registerQuery({ all: [cCircle, cPosition, cIntersecting]});

// SYSTEMS - registration order matters! (can be changed later with world.moveSystem())

const sMovement = world.registerSystem({
  name: "Movement",
  query: qMovement,
  update: (entities, global, dt) => {
    const canvas = global.Canvas;
    const multiplier = global.Demo.speedMultiplier;
    entities.forEach((entity) => {
      const position = entity.Position;
      const acceleration = entity.Acceleration;
      const velocity = entity.Velocity;
      position.x += velocity.x * acceleration.x * dt * multiplier ;
      position.y += velocity.y * acceleration.y * dt * multiplier ;
      if (acceleration.x > 1) acceleration.x -= dt * multiplier;
      if (acceleration.y > 1) acceleration.y -= dt * multiplier;
      if (acceleration.x < 1) acceleration.x = 1;
      if (acceleration.y < 1) acceleration.y = 1;

      const radius = entity.Circle.radius;
      if ((position.y + radius) < 0) position.y = canvas.height + radius;
      if ((position.y - radius) > canvas.height) position.y = -radius;
      if ((position.x - radius) > canvas.width) position.x = 0;
      if ((position.x + radius) < 0) position.x = canvas.width;
    });
  },
});
sMovement.enable();

const sCircle = world.registerSystem({
  name: "Circle",
  query: qCircle,
  pre: (entities, global) => {
    entities.forEach((entity, idx, arr) => {
      entity.Intersecting.points.length = 0;
    });
  },
  update: (entities, global, _dt) => {
    entities.forEach((entity, idx, arr) => {
      // entity.Intersecting.points.length = 0;
      for (let j = idx + 1; j < entities.length; j++) {
        const entityB = entities[j];
        const intersect = intersection(entity, entityB);
        if (intersect !== false) {
          entity.Intersecting.points.push(intersect);
        }
      }
    });
  },
  post: (entities, global, _int) => {
    const canvas = global.Buffer;
    canvas.ctx.fillStyle = "black";
    canvas.ctx.fillRect(0, 0, canvas.width, canvas.height);

    entities.forEach((entity) => {
      const position = entity.Position;
      canvas.ctx.beginPath();
      canvas.ctx.arc(
        position.x,
        position.y,
        entity.Circle.radius,
        0,
        2 * Math.PI,
        false
      );
      canvas.ctx.lineWidth = 1;
      canvas.ctx.strokeStyle = "#fff";
      canvas.ctx.stroke();

      let intersect = entity.Intersecting;
      canvas.ctx.strokeStyle = "#ff9";
      canvas.ctx.lineWidth = 2;
      canvas.ctx.fillStyle = "#fff";
      for (let j = 0; j < intersect.points.length; j++) {
        const points = intersect.points[j];
        fillCircle(canvas.ctx, points[0], points[1], 3);
        fillCircle(canvas.ctx, points[2], points[3], 3);
        drawLine(canvas.ctx, points[0], points[1], points[2], points[3]);
      }
    });
  },
});
sCircle.enable();

const sRender = world.registerSystem({
  name: "Renderer",
  post: (_entities, global, _int) => {
    const buffer = global.Buffer;
    const canvas = global.Canvas;
    const ctx = canvas.ctx;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer.ctx.canvas, 0, 0, canvas.width, canvas.height);
  },
});
sRender.enable();

// SETUP

for (let i = 0; i < 30; i++) {
  const entity = world.createEntity();
  entity.addComponent(cCircle, {radius: random(20, 100)});
  entity.addComponent(cIntersecting);
  entity.addComponent(cAcceleration);
  entity.addComponent(cPosition, {
    x: random(0, bufferCanvas.width),
    y: random(0, bufferCanvas.height),
  });
  entity.addComponent(cVelocity, {
    x: random(-20, 20),
    y: random(-20, 20),
  });
  entity.enable();
}

function resize() {
  globalCanvas.width = cnv.width = window.innerWidth;
  globalCanvas.height = cnv.height = window.innerHeight;
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
