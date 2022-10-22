/// <reference path="../../dist/miski.min.d.ts" />
import { Component, Query, System, World, SystemCallback } from "../../dist/miski.min.js";
import { Engine, State } from './engine.js';

// Constants
const INIT_NUM_ASTEROIDS = 10;

// Components
const Heading = new Component({ name: "heading", schema: { h: Float32Array }});
const Position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array }});
const Size = new Component({ name: "size", schema: { s: Int8Array }});
const Velocity = new Component({ name: "velocity", schema: { v: Float32Array }});
const Player = new Component({ name: "player", maxEntities: 1 });
const PlayerMissile = new Component({ name: "playerMissile", schema: { age: Int8Array } });
const Collidable = new Component({ name: "collidable", schema: { collisionType: Uint32Array }});

// Canvas
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

// Canvas resizing
function resizeCanvas() {
  const { devicePixelRatio = 1 } = window;
  const { clientHeight = 640, clientWidth = 480 } = document?.documentElement;
  canvas.width = clientWidth * devicePixelRatio;
  canvas.height = clientHeight * devicePixelRatio;
  canvas.style.width = clientWidth + "px";
  canvas.style.height = clientHeight + "px";
  ctx.scale(devicePixelRatio, devicePixelRatio);
};

/** @param {World} world */
const Collider = function(world) {
  const collision = (components, entities) => {
    const { collidable } = components;
    const { collisionType } = collidable;
    for (const entity of entities) {

    }
  }
};

/** @type {State} */
const Playing = {
  activate() {},
  deactivate() {},
  render(alpha, game) {
    const { renderAsteroids, renderRockets, renderShips } = game;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderAsteroids(alpha);
    renderShips(alpha);
    renderRockets(alpha);
  },
  update(delta, game) {
    const { updateAsteroids, updateHero, updateRockets, updateShips } = game;
    updateShips(delta);
    updateHero(delta);
    updateRockets(delta);
    updateAsteroids(delta);
  },
};

// Init
/** @param {World} world */
function init(world) {
  const { createAsteroid, renderAsteroids, updateAsteroids } = Asteroid(world);
  const { createHero, renderHero, updateHero } = Hero(world);
  const { createRocket, renderRockets, updateRockets } = Rocket(world);
  const { renderShips, updateShips } = Ship(world);

  // Create asteroids
  const initialAsteroids = [];
  for (let i = 0; i < INIT_NUM_ASTEROIDS; i++) {
    const asteroid = createAsteroid(world);
    if (asteroid) initialAsteroids.push(asteroid);
  }

  // Create Player
  const player = createHero();

  return {
    player,
    initialAsteroids,
    createAsteroid,
    createRocket,
    renderAsteroids: renderAsteroids.init(world),
    renderHero: renderHero.init(world),
    renderRockets: renderRockets.init(world),
    renderShips: renderShips.init(world),
    updateAsteroids: updateAsteroids.init(world),
    updateHero: updateHero.init(world),
    updateRockets: updateRockets.init(world),
    updateShips: updateShips.init(world),
   };
}

// Main
window.addEventListener("loaded", () => {
  // Engine
  const engine = new Engine(60);
  window.engine = engine;

  // World
  const world = new World({
    capacity: 1000,
    components: [
      Heading,
      Player,
      PlayerMissile,
      Position,
      Size,
      Velocity,
    ],
  });
  window.world = world;

  // Canvas Setup
  ctx.imageSmoothingEnabled = false;

  // Handle window resizing
  resizeCanvas();
  window.addEventListener("resize", resize, { passive: true });

  // Handle input
  window.addEventListener("keydown", (e) => {
    const keycode = e.which || window.event.keycode;
    if (keycode > 36 && keycode < 33) e.preventDefault();
    game.keyDown(keycode);
  });
  window.addEventListener("keyup", (e) => {
    const keycode = e.which || window.event.keycode;
    game.keyUp(keycode);
  });

  // Initialize
  const game = {
    canvas,
    ctx,
    engine,
    fns: init(world),
    world,
  };

  // Start the game
  engine.changeState(Playing, game);
  engine.start();
}, { passive: true, once: true });
