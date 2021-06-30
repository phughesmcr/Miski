"use strict";

import { performance, PerformanceObserver } from "perf_hooks";
import { createComponent, createWorld, Types } from "../miski.min.js";

const ITERATIONS = 5000;
const COUNT = 2;

const perfObserver = new PerformanceObserver((items) => {
  items.getEntries().forEach((entry) => {
    console.log(entry)
  })
})

perfObserver.observe({ entryTypes: ["function"] })


let world;
function createNewWorld() {
  world = createWorld();
}

const entities = [];
function createNewEntities() {
  for (let i = 0; i < COUNT; i++) {
    entities.push(world.createEntity());
  }
}

let position;
let velocity;
function createNewComponents() {
  position = createComponent({
    name: "Position",
    schema: {
      x: Types.f32,
      y: Types.f32,
    },
  });
  velocity = createComponent({
    name: "Velocity",
    schema: {
      dx: Types.f32,
      dy: Types.f32,
    },
  });
}


let cPosition;
let cVelocity;
function registerComps() {
  cPosition = world.registerComponent(position);
  cVelocity = world.registerComponent(velocity);
}

function addComponents() {
  for (let i = 0; i < COUNT; i++) {
    world.addComponentToEntity(entities[i], cPosition);
    world.addComponentToEntity(entities[i], cVelocity);
  }
}

let query;
function makeQuery() {
  query = world.registerQuery({
    name: "Movement",
    all: [cPosition, cVelocity],
  });
}

let system;
function makeSystem() {
  system = world.registerSystem({
    name: "Movement",
    query: query,
    update: (entities, _dt) => {
      entities.forEach((entity) => {
        cPosition.x[entity] += cVelocity.dx[entity];
        cPosition.y[entity] += cVelocity.dy[entity];
      });
    },
  });
  system.enable();
}

function doStep() {
  world.step();
}

function doRemove() {
  const entity = entities.pop();
  world.removeComponentFromEntity(entity, cPosition);
}

const createWorldTimer = performance.timerify(createNewWorld);
const createEntitiesTimer = performance.timerify(createNewEntities);
const createNewComponentsTimer = performance.timerify(createNewComponents);
const registerCompsTimer = performance.timerify(registerComps);
const addComponentsTimer = performance.timerify(addComponents);
const makeQueryTimer = performance.timerify(makeQuery);
const makeSystemTimer = performance.timerify(makeSystem);
const doStepTimer = performance.timerify(doStep);
const doRemoveTimer = performance.timerify(doRemove);

createWorldTimer();
createEntitiesTimer();
createNewComponentsTimer();
registerCompsTimer();
addComponentsTimer();
makeQueryTimer();
makeSystemTimer();
doStepTimer();
doRemoveTimer();
