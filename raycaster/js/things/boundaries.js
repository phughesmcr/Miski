"use strict";

import { rnd } from '../utils.js';

function createBoundary(world) {
  const boundary = world.createEntity();
  const component = world.getComponentByName('boundary');
  if (!component) throw new Error(`'boundary component not found!`);
  world.addComponentsToEntity(boundary, component);
  boundary.components.boundary = {
    start: {
      x: rnd(0, world.entity.components.buffer.ctx.canvas.width ?? 100),
      y: rnd(0, world.entity.components.buffer.ctx.canvas.height ?? 100),
      z: 0,
    },
    end: {
      x: rnd(0, world.entity.components.buffer.ctx.canvas.width ?? 100),
      y: rnd(0, world.entity.components.buffer.ctx.canvas.height ?? 100),
      z: 0,
    },
  };
  return boundary;
}

function createRandomBoundaries(world, n) {
  const boundaries = []
  for (let i = 0; i < n; i++) {
    boundaries.push(createBoundary(world));
  }
  return boundaries;
}

function createEdges(world) {
  const canvas = world.entity.components.buffer.canvas;
  // top
  const bTop = createBoundary(world);
  bTop.components.boundary = {
    start: {x: 0, y: 0},
    end: {x: canvas.width, y: 0},
  };
  // right
  const bRight = createBoundary(world);
  bRight.components.boundary = {
    start: {x: canvas.width,  y: 0},
    end: {x: canvas.width, y: canvas.height},
  };
  // bottom
  const bBottom = createBoundary(world);
  bBottom.components.boundary = {
    start: {x: 0, y: canvas.height},
    end: {x: canvas.width, y: canvas.height},
  };
  // left
  const bLeft = createBoundary(world);
  bLeft.components.boundary = {
    start: {x: 0, y: 0},
    end: {x: 0, y: canvas.height},
  };
  return [
    bTop,
    bRight,
    bBottom,
    bLeft,
  ];
}

export function createBoundaries(world, n) {
  return [
    ...createEdges(world),
    ...createRandomBoundaries(world, n),
  ];
}
