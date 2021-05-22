"use strict";

import { angleToRad, createVec } from '../utils.js';

// [buffer, context]
function render(int, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    /** @type {CanvasRenderingContext2D} */
    const ctx = entity.components.canvas.ctx;
    /** @type {CanvasRenderingContext2D} */
    const bufferCtx = entity.components.buffer.ctx;
    const bufferCnv = bufferCtx.canvas;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(bufferCnv, 0, 0);
    bufferCtx.clearRect(0, 0, bufferCnv.width, bufferCnv.height);
  }
}

// [player, mouse, heading]
function rotatePlayer(dt, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    if (entity.components.mouseinput.mX !== 0) {
      entity.components.heading.heading = ((entity.components.heading.heading + (entity.components.mouseinput.mX * 100)) * dt) % 360;
    }
  }
}

// [player, keyboard, position, velocity]
function movePlayer(dt, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    entity.components.position.x += (entity.components.velocity.x * 100) * dt;
    entity.components.position.y += (entity.components.velocity.y * 100) * dt;
  }
}

function createRay(pos, heading, angle) {

}

//[raycaster, position, heading]
function castRays(dt, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    const raycaster = entity.components.raycaster;
    const heading = entity.components.heading.heading;
    if ((raycaster.rays.length === 0 && raycaster.fov !== 0) || raycaster.rays.length !== raycaster.fov) {
      raycaster.rays.length = 0;
      for (let i = -raycaster.fov / 2; i < raycaster.fov / 2; i++) {
        raycaster.rays.push(createRay(entity.components.position, angleToRad(i) + angleToRad(heading)));
      }
    }

    // rotate
    /* let idx = 0;
    entity.components.heading.heading += angle
    for (let i = -raycaster.fov / 2; i < raycaster.fov / 2; i++) {
      raycaster.rays[idx].setAngle(angleToRad(i) + angleToRad(heading));
    } */




  }
}




function updateRays(dt, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    const fov = entity.components.raycaster.fov;
    const rad = entity.components.heading.heading * (Math.PI / 180);

    entity.components.raycaster.rays.length = 0;

    const a = (fov * (Math.PI / 180)) - (entity.components.heading.heading / 2);
    for (let i = 0; i < fov; i++) {
      const b = a + (i * (Math.PI / 180));
      entity.components.raycaster.rays.push();
    }
}

function drawRays(int, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    const rays = entity.components.raycaster.rays;
    for (let ray of rays) {

    }
  }
}

function drawPlayer(int, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    /** @type {CanvasRenderingContext2D} */
    const buffer = entity.world.entity.components.buffer.ctx;

    buffer.save();
    buffer.fillStyle = '#fff';
    buffer.fillRect(entity.components.position.x, entity.components.position.y, 10, 10);
    buffer.restore();
  }
}

function drawBoundaries(int, entities) {
  if (!entities.length) return;
  const len = entities.length - 1;
  for (let i = len; i >= 0; i--) {
    /** @type {Entity} */
    const entity = entities[i];
    /** @type {CanvasRenderingContext2D} */
    const buffer = entity.world.entity.components.buffer.ctx;

    buffer.save();
    buffer.strokeStyle = '#fff';
    buffer.beginPath();
    buffer.moveTo(entity.components.boundary.start.x, entity.components.boundary.start.y);
    buffer.lineTo(entity.components.boundary.end.x, entity.components.boundary.end.y);
    buffer.stroke();
    buffer.restore();
  }
}

export const systems = {
  render,
  drawBoundaries,
  drawPlayer,
  movePlayer,
  rotatePlayer,
};
