/// <reference lib="dom" />

/**
 * @module demo
 * @description A predator-prey simulation using Miski and Canvas2D.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

// The only Miski imports we need:
import { Component, type ComponentInstance, Query, type Schema, System, World } from "../mod.ts";

// ############################################################################
// DEMO CONFIG - not Miski specific
// ############################################################################

const CAPACITY = 1024;
const PREDATOR_SPAWN_COUNT = 1;
const PREY_SPAWN_COUNT = 1;
const WIDTH = 100;
const HEIGHT = 100;
const VELOCITY_SCALAR = 10;

const FIXED_TIME_STEP = 1000 / 60; // 60 FPS in ms
const MAX_UPDATES = 5;

const QUIET = false;
const VERBOSE = !QUIET && false;

// ############################################################################
// GRID - not Miski specific
// ############################################################################

const grid: string[][] = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill("."));

const clearGrid = () => {
  for (let y = 0; y < HEIGHT; y++) {
    grid[y]!.fill(".");
  }
};

// Helper to safely place character in grid
const placeOnGrid = (x: number, y: number, char: string) => {
  const gridX = Math.min(Math.floor(x), WIDTH - 1);
  const gridY = Math.min(Math.floor(y), HEIGHT - 1);
  if (VERBOSE) {
    console.log(`Placing ${char} at (${gridX}, ${gridY})`);
  }
  if (gridX >= 0 && gridY >= 0) {
    grid[gridY]![gridX] = char;
  }
};

const printScreen = () => {
  console.clear();
  const border = "-".repeat(WIDTH + 2);
  console.log(border);
  console.log(
    grid.map((row) => `|${row.join("")}|`).join("\n"),
  );
  console.log(border);
};

// ############################################################################
// COMPONENTS
// ############################################################################

// For type safety and DRY purposes, we can define a type for the schema of our components, but this is optional.
type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

const schemaVec2: Schema<Vec2> = {
  x: Float32Array,
  y: Float32Array,
};

const velocity = new Component<Vec2>({
  name: "velocity",
  schema: schemaVec2,
});

const position = new Component({
  name: "position",
  schema: schemaVec2,
});

const previousPosition = new Component({
  name: "previousPosition",
  schema: schemaVec2,
});

// Tags are components that have no schema / data.
const predator = new Component<null>({ name: "predator" });

const prey = new Component({ name: "prey" });

// ############################################################################
// WORLD
// ############################################################################

// Now that we have our components, we can create our world.
// First, you need to decide what the maximum number of entities you need will be.
// Pass this number to the World constructor as the `capacity` parameter.
// THIS CANNOT BE CHANGED LATER.
const world = new World({
  capacity: CAPACITY,
  components: [
    velocity,
    position,
    previousPosition,
    predator,
    prey,
  ],
});

// Initialize the world before use
await world.init();

// ############################################################################
// ENTITIES
// ############################################################################

const creatureSpawner = (x: number, y: number) => {
  const entity = world.entities.create();
  if (entity === undefined) return;
  world.components.addToEntity(position, entity, { x, y });
  world.components.addToEntity(previousPosition, entity, { x, y });
  world.components.addToEntity(velocity, entity, {
    x: Math.random() * VELOCITY_SCALAR,
    y: Math.random() * VELOCITY_SCALAR,
  });
  return entity;
};

const predatorSpawner = (x: number, y: number) => {
  const entity = creatureSpawner(x, y);
  if (entity === undefined) return;
  world.components.addToEntity(predator, entity);
  return entity;
};

const preySpawner = (x: number, y: number) => {
  const entity = creatureSpawner(x, y);
  if (entity === undefined) return;
  world.components.addToEntity(prey, entity);
  return entity;
};

for (let i = 0; i < PREDATOR_SPAWN_COUNT; i++) {
  const x = Math.random() * WIDTH;
  const y = Math.random() * HEIGHT;
  const entity = predatorSpawner(x, y);
  if (VERBOSE) {
    if (entity !== undefined) {
      console.log(`[${entity}] Predator spawned at (${x}, ${y})`);
    } else {
      console.log(`[${entity}] Failed to spawn predator at (${x}, ${y})`);
    }
  }
}

for (let i = 0; i < PREY_SPAWN_COUNT; i++) {
  const x = Math.random() * WIDTH;
  const y = Math.random() * HEIGHT;
  const entity = preySpawner(x, y);
  if (VERBOSE) {
    if (entity !== undefined) {
      console.log(`[${entity}] Prey spawned at (${x}, ${y})`);
    } else {
      console.log(`[${entity}] Failed to spawn prey at (${x}, ${y})`);
    }
  }
}

// ############################################################################
// QUERIES
// ############################################################################

// QUERIES
// Queries are used to select entities that have certain components.
// They are defined by the `Query` class.

const movementQuery = new Query({
  all: [position, velocity],
});

const previousPositionQuery = new Query({
  all: [position, previousPosition],
});

const predatorQuery = new Query({ all: [position, velocity, previousPosition, predator] });
const preyQuery = new Query({ all: [position, velocity, previousPosition, prey] });

// ############################################################################
// SYSTEMS
// ############################################################################

// Systems are functions that are executed on a set of entities.
// They are defined by the `System` class.
// Systems are executed in the order they are added to the world.

const movementSystem = new System({
  name: "movement",
  query: movementQuery,
  callback: (components, entities, dt: number) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: velocity } = components["velocity"] as ComponentInstance<Vec2>;

    for (const entity of entities) {
      position.cursor = entity;
      velocity.cursor = entity;

      position.x += velocity.x * dt;
      position.y += velocity.y * dt;

      // boundary checks with canvas dimensions
      if (position.x < 0) {
        position.x = 0;
        velocity.x = -velocity.x;
      } else if (position.x > WIDTH) {
        position.x = WIDTH;
        velocity.x = -velocity.x;
      }

      if (position.y < 0) {
        position.y = 0;
        velocity.y = -velocity.y;
      } else if (position.y > HEIGHT) {
        position.y = HEIGHT;
        velocity.y = -velocity.y;
      }
    }
  },
});

const renderPredatorSystem = new System({
  name: "renderPredator",
  query: predatorQuery,
  callback: (components, entities, alpha: number) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: previousPosition } = components["previousPosition"] as ComponentInstance<Vec2>;
    for (const entity of entities) {
      position.cursor = entity;
      previousPosition.cursor = entity;
      placeOnGrid(
        previousPosition.x + (position.x - previousPosition.x) * alpha,
        previousPosition.y + (position.y - previousPosition.y) * alpha,
        "X",
      );
    }
  },
});

const renderPreySystem = new System({
  name: "renderPrey",
  query: preyQuery,
  callback: (components, entities, alpha: number) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: previousPosition } = components["previousPosition"] as ComponentInstance<Vec2>;
    for (const entity of entities) {
      position.cursor = entity;
      previousPosition.cursor = entity;
      placeOnGrid(
        previousPosition.x + (position.x - previousPosition.x) * alpha,
        previousPosition.y + (position.y - previousPosition.y) * alpha,
        "O",
      );
    }
  },
});

const updatePreviousPositionSystem = new System({
  name: "updatePreviousPosition",
  query: previousPositionQuery,
  callback: (components, entities) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: previousPosition } = components["previousPosition"] as ComponentInstance<Vec2>;
    for (const entity of entities) {
      position.cursor = entity;
      previousPosition.cursor = entity;
      previousPosition.x = position.x;
      previousPosition.y = position.y;
    }
  },
});

// Initialize systems in a world like so:
const movement = world.systems.create(movementSystem);
const renderPrey = world.systems.create(renderPreySystem);
const renderPredator = world.systems.create(renderPredatorSystem);
const updatePreviousPosition = world.systems.create(updatePreviousPositionSystem);

// ############################################################################
// GAME LOOP - not Miski specific
// ############################################################################

let running = true;
let lastTime = 0;
let accumulator = 0;

async function gameLoop(currentTime: number = performance.now()): Promise<void> {
  if (!running) return;

  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  accumulator += deltaTime;

  let updates = 0;
  while (accumulator >= FIXED_TIME_STEP && updates < MAX_UPDATES) {
    updatePreviousPosition();
    movement(FIXED_TIME_STEP);
    accumulator -= FIXED_TIME_STEP;
    updates++;
  }

  // Clear game grid
  clearGrid();

  // Calculate interpolation factor
  const alpha = accumulator / FIXED_TIME_STEP;

  // Call render systems
  renderPredator(alpha);
  renderPrey(alpha);

  // print screen to console
  printScreen();
}

world.onReady().then(() => {
  // setInterval(gameLoop, FIXED_TIME_STEP);
  gameLoop(performance.now());
});
