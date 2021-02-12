// based on https://github.com/fireveined/ecs-benchmark-js
"use strict";

// import the createWorld function from Miski
import { createWorld } from "../../dist/esm/index.min.js";

const output = document.getElementById('main');

// setup
const updates = { num: 0 };
const TEST_COUNT = 1000;
const RUN_COUNT = 5;

function setup() {
    // create our world - most functions take place through the world object
    const world = createWorld();

    // create our test components
    const cPosition = world.registerComponent({
      name: "position",
      properties: {
        x: 0,
        y: 0,
        reset: () => {
          this.x = 0;
          this.y = 0;
        },
      },
    });

    const cRender = world.registerComponent({
      name: "render",
      properties: {
        view: {},
        reset: () => {
          this.view = {};
        }
      },
    });

    const cHistory = world.registerComponent({
      name: "history",
      properties: {
        history: "some string",
        reset: () => {
          this.history = "some string";
        }
      },
    });

    const cVelocity = world.registerComponent({
      name: "velocity",
      properties: {
        dx: 0,
        dy: 0,
        reset: () => {
          this.dx = 0;
          this.dy = 0;
        },
      },
    });

    // create our test systems
    const sPosition = world.registerSystem({
      name: "position",
      components: [cPosition],
      update: function(dt, entities, system) {
        for (const entity of entities) {}
      },
    });
    sPosition.enable();

    const sVelocity = world.registerSystem({
      name: "velocity",
      components: [cPosition, cVelocity],
      update: function(dt, entities, system) {
        for (const entity of entities) {
          if (entity._.velocity?.dx == undefined) continue
          entity._.position.x += entity._.velocity.dx;
          entity._.position.y += entity._.velocity.dy;
          updates.num++;
        }
      },
    });
    sVelocity.enable();

    const sRender = world.registerSystem({
      name: "render",
      components: [cPosition, cRender, cVelocity],
      update: function(dt, entities, system) {},
    });
    sRender.enable();

    return world;
}

function printResult(name, str) {
  const p = document.createElement('p');
  const s = document.createElement('strong');
  s.textContent = `${name}: `;
  p.textContent = str;
  main.appendChild(s);
  main.appendChild(p);
}

function testAdd() {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i++) {
    const world = setup();
    const start = performance.now();
    for (let j = 0; j < TEST_COUNT; j++ ) {
      const eA = world.createEntity();
      world.addComponentsToEntity(eA, "position");
      const eB = world.createEntity();
      world.addComponentsToEntity(eB, "position", "velocity");
      const eC = world.createEntity();
      world.addComponentsToEntity(eC, "position", "velocity", "render");
      const eD = world.createEntity();
      world.addComponentsToEntity(eD, "position", "velocity", "render", "history");
    }
    const end = performance.now();
    total += (end - start);
  }
  const avg = total / RUN_COUNT;
  printResult('Add', `${Math.round(avg)}ms average. ${updates.num} updates (${updates.num / RUN_COUNT} per run).`);
  updates.num = 0;
}

function testAddUpdate() {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i++) {
    const world = setup();
    const start = performance.now();
    for (let j = 0; j < TEST_COUNT; j++ ) {
      const eA = world.createEntity();
      world.addComponentsToEntity(eA, "position");
      const eB = world.createEntity();
      world.addComponentsToEntity(eB, "position", "velocity");
      const eC = world.createEntity();
      world.addComponentsToEntity(eC, "position", "velocity", "render");
      const eD = world.createEntity();
      world.addComponentsToEntity(eD, "position", "velocity", "render", "history");
      world.update(1);
      world.update(1);
      world.update(1);
    }
    const end = performance.now();
    total += (end - start);
  }
  const avg = total / RUN_COUNT;
  printResult('Add-Update', `${Math.round(avg)}ms average. ${updates.num} updates (${updates.num / RUN_COUNT} per run).`);
  updates.num = 0;
}

function testAddUpdateDestroy() {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i++) {
    const world = setup();
    const all = [];
    const start = performance.now();
    for (let j = 0; j < TEST_COUNT; j++ ) {
      const eA = world.createEntity();
      world.addComponentsToEntity(eA, "position");
      const eB = world.createEntity();
      world.addComponentsToEntity(eB, "position", "velocity");
      const eC = world.createEntity();
      world.addComponentsToEntity(eC, "position", "velocity", "render");
      const eD = world.createEntity();
      world.addComponentsToEntity(eD, "position", "velocity", "render", "history");
      all.push(eA, eB, eC, eD);
      world.update(1);
      world.update(1);
      world.update(1);
      world.destroyEntity(all[j]);
      world.destroyEntity(all[j * 2 + 1]);
      all.splice(j * 2 + 1, 1);
      all.splice(j, 1);
    }
    const end = performance.now();
    total += (end - start);
  }
  const avg = total / RUN_COUNT;
  printResult('Add-Update-Destroy', `${Math.round(avg)}ms average. ${updates.num} updates (${updates.num / RUN_COUNT} per run).`);
  updates.num = 0;
}

function testAddUpdateDestroyRemove() {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i++) {
    const world = setup();
    const all = [];
    const start = performance.now();
    for (let j = 0; j < TEST_COUNT; j++ ) {
      const eA = world.createEntity();
      world.addComponentsToEntity(eA, "position");
      const eB = world.createEntity();
      world.addComponentsToEntity(eB, "position", "velocity");
      const eC = world.createEntity();
      world.addComponentsToEntity(eC, "position", "velocity", "render");
      const eD = world.createEntity();
      world.addComponentsToEntity(eD, "position", "velocity", "render", "history");
      all.push(eA, eB, eC, eD);
      world.update(1);
      world.update(1);
      world.update(1);
      world.destroyEntity(all[j]);
      world.destroyEntity(all[j * 2 + 1]);
      all.splice(j * 2 + 1, 1);
      all.splice(j, 1);
      world.removeComponentsFromEntity(all[j + 1], "velocity");
      world.removeComponentsFromEntity(all[j * 2], "velocity");
    }
    const end = performance.now();
    total += (end - start);
  }
  const avg = total / RUN_COUNT;
  printResult('Add-Update-Destroy-Remove', `${Math.round(avg)}ms average. ${updates.num} updates (${updates.num / RUN_COUNT} per run).`);
  updates.num = 0;
}

function testAddUpdateDestroyCreate() {
  let total = 0;
  for (let i = 0; i < RUN_COUNT; i++) {
    const world = setup();
    const all = [];
    const start = performance.now();
      for (let j = 0; j < TEST_COUNT; j++ ) {
      const eA = world.createEntity();
      world.addComponentsToEntity(eA, "position");
      const eB = world.createEntity();
      world.addComponentsToEntity(eB, "position", "velocity");
      const eC = world.createEntity();
      world.addComponentsToEntity(eC, "position", "velocity", "render");
      const eD = world.createEntity();
      world.addComponentsToEntity(eD, "position", "velocity", "render", "history");
      all.push(eA, eB, eC, eD);
      world.update(1);
      world.update(1);
      world.update(1);
      world.addComponentsToEntity(eA, "velocity");
      world.destroyEntity(all[j]);
      world.destroyEntity(all[j * 2 + 1]);
      all.splice(j * 2 + 1, 1);
      all.splice(j, 1);
    }
    const end = performance.now();
    total += (end - start);
  }
  const avg = total / RUN_COUNT;
  printResult('Add-Update-Destroy-Create', `${Math.round(avg)}ms average. ${updates.num} updates (${updates.num / RUN_COUNT} per run).`);
  updates.num = 0;
}

const btnRun = document.querySelector('button');
btnRun.addEventListener('click', () => {
  btnRun.textContent = "RUNNING";
  btnRun.disabled = true;
  setTimeout(() => {
    testAdd();
    testAddUpdate();
    testAddUpdateDestroy();
    testAddUpdateDestroyRemove();
    testAddUpdateDestroyCreate();
    btnRun.textContent = "Run benchmarks";
    btnRun.disabled = false;
  }, 33);
}, {passive: true});
