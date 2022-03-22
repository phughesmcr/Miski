/**
 * A recreation of Derek Banas' Asteroids tutorial using Miski
 * @see https://www.youtube.com/watch?v=HWuU5ly0taA for Derek's original tutorial
 */
"use strict";

import { createComponent, createQuery, createSystem, createWorld } from "../../../../dist/miski.min.js";

// Utility functions
function rnd(a, b) { return Math.random() * (b - a) + a; }
function toRads(angle) { return angle / Math.PI * 180; }

// Simulation constants
const THREESIXTY = Math.PI * 2;
const PLAYER_ANGLE = THREESIXTY / 3;
const ASTEROID_ANGLE = THREESIXTY / 6;

// Canvas setup
const canvas = document.getElementsByTagName('canvas')[0];
const ctx = canvas.getContext('2d');
canvas.width = 1400;
canvas.height = 1000;
ctx.fillStyle = "#000"
ctx.strokeStyle = "#FFF";
ctx.lineWidth = 2;

// Keypress handling
const keys = [];
document.body.addEventListener("keydown", (e) => { keys[e.keyCode] = true; }, { passive: true });
document.body.addEventListener("keyup", (e) => { keys[e.keyCode] = false; }, { passive: true });

// Colors enum
const COLORS = {
  0: "#FFF",
  1: "#000",
  2: "red",
  3: "grey",
}

// Components
const cAngle = createComponent({ name: "angle", schema: { degrees: Float32Array } });
const cNose = createComponent({ name: "nose", schema: { nx: Float32Array, ny: Float32Array }});
const cPosition = createComponent({ name: "position", schema: { x: Float32Array, y: Float32Array }});
const cRect = createComponent({ name: "rect", schema: { h: Uint8Array, w: Uint8Array }});
const cRotation = createComponent({ name: "rotation", schema: { direction: Float32Array, rotationSpeed: Float32Array } });
const cSize = createComponent({ name: "size", schema: { radius: Uint8Array } });
const cSpeed = createComponent({ name: "speed", schema: { acceleration: Float32Array } });
const cStrokeColor = createComponent({ name: "strokeColor", schema: { stroke: Uint8Array } });
const cVelocity = createComponent({ name: "velocity", schema: { dx: Float32Array, dy: Float32Array }});

// Tags
const tAsteroid = createComponent({ name: "asteroid" });
const tBullet = createComponent({ name: "bullet" });
const tMoving = createComponent({ name: "moving" });
const tPlayer = createComponent({ name: "player" });
const tVisible = createComponent({ name: "visible" });
const tWrap = createComponent({ name: "wrap" });

// World
const world = createWorld({
  capacity: 256,
  components: [
    cAngle,
    cNose,
    cPosition,
    cRect,
    cRotation,
    cSize,
    cSpeed,
    cStrokeColor,
    cVelocity,
    tAsteroid,
    tBullet,
    tMoving,
    tPlayer,
    tVisible,
    tWrap,
  ]
});

// Destructure world methods
const {
  addComponentsToEntity,
} = world;

// Define player entity
const playerFactory = addComponentsToEntity(cAngle, cNose, cPosition, cRotation, cSize, cSpeed, cStrokeColor, cVelocity, tPlayer, tVisible);
const createPlayer = () => {
  const player = createEntity();
  if (player === undefined) throw new Error("NO PLAYER");
  playerFactory(player, {

  });
}
const PLAYER = createPlayer();

// define bullet factory
const bulletFactory = addComponentsToEntity(cAngle, cPosition, cRect, cSpeed, cStrokeColor, cVelocity, tBullet, tVisible);
const createBullet = (angle, x, y) => {
  const bullet = createEntity();
  if (bullet === undefined) return;
  bulletFactory(bullet, {
    angle: {
      degrees: angle,
    },
    position: {
      x,
      y,
    },
    rect: {
      h: 4,
      w: 4,
    },
    speed: {
      acceleration: 5,
    },
    stroke: {
      stroke: 2
    }
  });
  return bullet;
}
const bullets = new Array(50).map(bulletFactory);

// define asteroid factory
const asteroidFactory = addComponentsToEntity(cPosition, tAsteroid, tVisible, cSpeed, cSize, cAngle, cStrokeColor);
const createAsteroid = () => {
  const asteroid = createEntity();
  if (asteroid === undefined) return;
  asteroidFactory(asteroid, {
    position: {
      x:Math.floor(Math.random() * canvas.width),
      y:Math.floor(Math.random() * canvas.height),
    },
    speed: {
      acceleration: 1,
    },
    size: {
      radius: 50,
    },
    angle: {
      degrees: Math.floor(Math.random() * 359),
    },
    stroke: {
      stroke: 3,
    }
  });
  return asteroid;
}
const asteroids = new Array(8).map(createAsteroid);

// Queries
const qWrap = createQuery({ all: [cPosition, cSize, tWrap]});
const qPlayer = createQuery({ all: [cAngle, cNose, cPosition, cRotation, cSize, cSpeed, cStrokeColor, cVelocity, tPlayer], any: [tMoving], not: [tAsteroid, tBullet] });
const qNPC = createQuery({ all: [cAngle, cPosition, cRect, cSpeed, cStrokeColor], any: [tAsteroid, tBullet], not: [tPlayer] });
const qNose = createQuery({ all: [tPlayer, cNose, cAngle, cPosition, cSize]})
const qBullet = createQuery({ all: [tBullet, cPosition, cRect, cStrokeColor]})
const qAsteroid = createQuery( {all: [tAsteroid, tVisible, cPosition, cSpeed, cSize, cAngle, cStrokeColor]})

const qDrawPlayer = createQuery({ all: [tPlayer, cStrokeColor, cAngle, cPosition, cSize] })
const qRender = createQuery({ all: [tPlayer]})

// Systems
const sWrap = createSystem((components, entities) => {
  const { position, size } = components;
  const { x, y } = position;
  const { radius } = size;
  const update = (entity) => {
    if (x[entity] < radius[entity]) {
      x[entity] = canvas.width;
    }
    if (x[entity] > canvas.width) {
      x[entity] = radius[entity];
    }
    if (y[entity] < radius[entity]) {
      y[entity] = canvas.height;
    }
    if (y[entity] > canvas.height) {
      y[entity] = radius[entity];
    }
  }
  entities.forEach(update);
}, qWrap)(world);

const hasMovingTag = hasComponent(tMoving);

const sUpdatePlayer = createSystem((components, entities, delta = 1) => {
  const { angle, position, speed, velocity, rotation } = components;
  const { degrees } = angle;
  const { dx, dy } = velocity;
  const { acceleration } = speed;
  const { x, y } = position;
  const { direction, rotationSpeed } = rotation;
  const move = (entity) => {
    if (entity !== PLAYER) return;
    // cache some variables
    const entityAngle = toRads(degrees[entity]);
    // rotate
    degrees[entity] += rotationSpeed[entity] * direction[entity];
    // move
    if (hasMovingTag(entity)) {
      dx[entity] += Math.cos(entityAngle) * acceleration[entity];
      dy[entity] += Math.sin(entityAngle) * acceleration[entity];
    }
    // inertia
    dx[entity] *= 0.99;
    dy[entity] *= 0.99;
    // friction
    x[entity] -= dx[entity];
    y[entity] -= dy[entity];
  }
  entities.forEach(move);
}, qPlayer)(world);

const sUpdateNose = createSystem((components, entities, delta = 1) => {
  const { angle, nose, position, size } = components;
  const { degrees } = angle;
  const { nx, ny } = nose;
  const { x, y } = position;
  const { radius } = size;
  const update = (entity) => {
    const entityAngle = toRads(degrees[entity]);
    const entityRadius = radius[entity];
    nx[entity] = x[entity] - entityRadius * Math.cos(entityAngle);
    ny[entity] = y[entity] - entityRadius * Math.sin(entityAngle);
  }
  entities.forEach(update);
}, qNose)(world);

const sUpdateNPCs = createSystem((components, entities, delta) => {
  const { angle, position, speed } = components;
  const { degrees } = angle;
  const { x, y } = position;
  const { acceleration } = speed;
  const update = (entity) => {
    const radians = toRads(degrees[entity]);
    x[entity] -= Math.cos(radians) * acceleration[entity];
    y[entity] -= Math.sin(radians) * acceleration[entity];
  }
  entities.forEach(update)
}, qNPC)(world);

const sDrawPlayer = createSystem((components, entities, delta = 1) => {
  const { angle, strokeColor, position, size } = components;
  const { stroke } = strokeColor;
  const { degrees } = angle;
  const { x, y } = position;
  const { radius } = size;
  const draw = (entity) => {
    if (entity !== PLAYER) return;
    const entityAngle = toRads(degrees[entity]);
    const entitySize = radius[entity];
    ctx.strokeStyle = COLORS[stroke[entity]];
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      ctx.lineTo(
        x[entity] - entitySize * Math.cos(PLAYER_ANGLE * i + entityAngle),
        y[entity] - entitySize * Math.sin(PLAYER_ANGLE * i + entityAngle)
      );
    }
    ctx.closePath();
    ctx.stroke();
  }
  entities.forEach(draw);
}, qDrawPlayer)(world);

const sDrawBullet = createSystem((components, entities, delta = 1) => {
  const { position, rect, strokeColor } = components;
  const { stroke } = strokeColor;
  const { h, w } = rect;
  const { x, y } = position;
  const draw = (entity) => {
    ctx.fillStyle = COLORS[stroke[entity]];
    ctx.fillRect(x[entity], y[entity], w[entity], h[entity]);
  }
  entities.forEach(draw);
}, qBullet)(world);

const sDrawAsteroid = createSystem((components, entities, alpha) => {
  const { angle, position, size, speed, strokeColor } = components;
  const { stroke } = strokeColor;
  const { degrees } = angle;
  const { radius } = size;
  const { x, y } = position;
  const draw = (entity) => {
    if (entity === PLAYER) return;
    const entityRadius = radius[entity];
    const entityAngle = toRads(degrees[entity]);
    ctx.strokeStyle = COLORS[stroke[entity]];
    ctx.beginPath();
    for(let i = 0; i < 6; i++){
      ctx.lineTo(
        x[entity] - entityRadius * Math.cos(ASTEROID_ANGLE * i + entityAngle),
        y[entity] - entityRadius * Math.sin(ASTEROID_ANGLE * i + entityAngle)
      );
    }
    ctx.closePath();
    ctx.stroke();
  }
  entities.forEach(draw);
}, qAsteroid)(world);

const sInput = createSystem((components, entities) => {
  const { position, rotation } = components;
  const { direction } = rotation;
  const { x, y } = position;
  const handleInput = (entity) => {
    if (entity !== PLAYER) return;
    // forward
    if (keys[87]) {
      const x = addComponentToEntity(tMoving, entity);
      console.log(x)
    } else {
      removeComponentFromEntity(tMoving, entity);
    }
    // rotation
    if (keys[68]) {
      // d key rotate right
      direction[entity] = 1;
    }
    if (keys[65]) {
      // a key rotate left
      direction[entity] = -1;
    }
    // bullets
    if (keys[32]) {
      bullets.push(createBullet(direction[PLAYER], x[entity], y[entity]))
    }
  }
  entities.forEach(handleInput);
}, qPlayer)(world);

const Render = (alpha = 0.1) => {
  ctx.fillStyle = "#000";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sDrawPlayer(alpha);
  sDrawBullet(alpha);
  sDrawAsteroid(alpha);
};

// Define your game loop (not Miski specific)
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

    // handle input
    sInput();

    while (stepAccumulator > tempo) {
      if (stepLastUpdate >= maxUpdates) {
        stepAccumulator = 1;
        break;
      }

      // call your systems just like regular functions
      sUpdatePlayer(tempo);
      sUpdateNose(tempo);
      sUpdateNPCs(tempo);
      sWrap(tempo);

      stepAccumulator -= tempo;
      stepLastUpdate++;
    }
  }

  stepLastTime = time;
  const alpha = stepAccumulator / tempo;
  // call your systems just like regular functions
  Render(alpha);
}
requestAnimationFrame(step);
