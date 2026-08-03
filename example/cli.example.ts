/**
 * @module demo
 * @description A predator-prey simulation using Miski in the terminal.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

// The only Miski imports we need:
import { Component, entityIndex, Query, type Schema, System, World } from "../mod.ts";

// ############################################################################
// DEMO CONFIG - not Miski specific
// ############################################################################

const CAPACITY = 1024;
const PREDATOR_SPAWN_COUNT = 6;
const PREY_SPAWN_COUNT = 10;
const WIDTH = 80;
const HEIGHT = 24;
const VELOCITY_SCALAR = 5;

const PREDATOR_CHAR_HIGH = "X";
const PREDATOR_CHAR_NORMAL = "#";
const PREDATOR_CHAR_LOW = "x";
const PREY_CHAR = "O";

// Predator-Prey behavior constants
const PREDATOR_SPEED = 6;
const PREY_SPEED = 7;
const PREDATOR_DETECTION_RANGE = 20;
const PREY_DETECTION_RANGE = 15;
const COLLISION_DISTANCE = 1.5;
const SEPARATION_DISTANCE = 2.0; // Minimum distance between entities (grid cells are 1x1)
const SEPARATION_FORCE = 50; // How strongly entities push apart
const MAX_VELOCITY = 15; // Maximum velocity magnitude to prevent extreme speeds
const MIN_WANDER_SPEED = 2; // Minimum speed for wandering behavior
const WANDER_CHANGE_RATE = 0.5; // How much random direction changes during wandering
const PREDATOR_INITIAL_ENERGY = 50;
const PREDATOR_MAX_ENERGY = 100;
const PREDATOR_ENERGY_LOSS_PER_SECOND = 6;
const PREDATOR_ENERGY_GAIN_FROM_PREY = 60;
const PREDATOR_STARVATION_THRESHOLD = 0;
const PREY_REPRODUCTION_COOLDOWN = 10; // seconds
const PREY_REPRODUCTION_DISTANCE = 3;
const PREY_MIN_POPULATION_FOR_REPRODUCTION = 3; // Minimum prey needed for reproduction to occur

const FIXED_TIME_STEP = 1000 / 60; // 60 FPS in ms
const MAX_UPDATES = 60;

const QUIET = false;
const VERBOSE = !QUIET && true;

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

// Store recent log messages
const recentLogs: string[] = [];
const MAX_LOG_LINES = 10;

const addLog = (message: string) => {
  recentLogs.push(message);
  if (recentLogs.length > MAX_LOG_LINES) {
    recentLogs.shift();
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

  const predators = world.entities.queryList(predatorQuery);
  const predatorCount = predators.count;
  let predatorEnergyDisplay = "";

  for (let i = 0; i < predatorCount; i++) {
    const entity = predators.entities[i]!;
    const slot = predators.indices[i]!;
    predatorEnergyDisplay += `[${entity}: ${energyStore.value[slot]!.toFixed(1)}] `;
  }

  const preyCount = world.entities.queryList(preyQuery).count;
  const total = predatorCount + preyCount;

  console.log(`Predators: ${predatorCount} | Prey: ${preyCount} | Total: ${total} | FPS: ${fps}`);
  console.log(`Predator Energy: ${predatorEnergyDisplay || "None"}`);
  console.log(
    `Legend: ${PREDATOR_CHAR_HIGH} = well-fed predator | ${PREDATOR_CHAR_NORMAL} = normal predator | ${PREDATOR_CHAR_LOW} = starving predator | ${PREY_CHAR} = prey`,
  );

  // Display recent logs
  if (recentLogs.length > 0) {
    console.log("\n--- Recent Events ---");
    for (const log of recentLogs) {
      console.log(log);
    }
  }
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

const position = new Component<Vec2>({
  name: "position",
  schema: schemaVec2,
});

const previousPosition = new Component<Vec2>({
  name: "previousPosition",
  schema: schemaVec2,
});

// Energy component for predators
type Energy = { value: Float32ArrayConstructor };
const energy = new Component<Energy>({
  name: "energy",
  schema: { value: Float32Array },
});

// Reproduction timer for prey
type ReproductionTimer = { value: Float32ArrayConstructor };
const reproductionTimer = new Component<ReproductionTimer>({
  name: "reproductionTimer",
  schema: { value: Float32Array },
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
    energy,
    reproductionTimer,
    predator,
    prey,
  ],
});

// Initialize the world before use
await world.init();

// Prefer `.storage.partitions` for SoA access; index by query-list slots, not packed handles.
const { partitions: positionStore } = world.components.require(position).storage;
const { partitions: energyStore } = world.components.require(energy).storage;

// Reusable scratch for cross-query spatial lookups (avoids per-frame array allocations).
const scratchEntities = new Uint32Array(CAPACITY);
const scratchX = new Float32Array(CAPACITY);
const scratchY = new Float32Array(CAPACITY);
const destroyScratch = new Uint32Array(CAPACITY);
const takenScratch = new Uint8Array(CAPACITY);

// ############################################################################
// HELPERS
// ############################################################################

const safeDestroyEntity = (entity: number): boolean => {
  if (!world.entities.isActive(entity)) {
    addLog(`  Entity ${entity} not active (already destroyed?)`);
    return false;
  }
  world.entities.destroy(entity);
  addLog(`  Entity ${entity} destroyed`);
  return true;
};

const batchDestroyEntities = (entities: Uint32Array, count: number): void => {
  for (let i = 0; i < count; i++) {
    safeDestroyEntity(entities[i]!);
  }
};

/** Copy a dense query's positions into scratch buffers. Returns the entity count. */
const gatherPositions = (query: Query): number => {
  const list = world.entities.queryList(query);
  const count = list.count;
  for (let i = 0; i < count; i++) {
    const slot = list.indices[i]!;
    scratchEntities[i] = list.entities[i]!;
    scratchX[i] = positionStore.x[slot]!;
    scratchY[i] = positionStore.y[slot]!;
  }
  return count;
};

// ############################################################################
// ENTITIES
// ############################################################################

const randomVelocity = (): { x: number; y: number } => ({
  x: (Math.random() - 0.5) * VELOCITY_SCALAR * 2,
  y: (Math.random() - 0.5) * VELOCITY_SCALAR * 2,
});

// Atomic spawn: one archetype move via createWith instead of repeated addToEntity.
const predatorSpawner = (x: number, y: number): number | undefined => {
  const entity = world.entities.createWith([
    [position, { x, y }],
    [previousPosition, { x, y }],
    [velocity, randomVelocity()],
    [predator],
    [energy, { value: PREDATOR_INITIAL_ENERGY }],
  ]);
  if (entity === undefined) {
    addLog(`Failed to create predator entity!`);
    return;
  }
  if (VERBOSE) {
    addLog(`Created predator entity ${entity}`);
  }
  return entity;
};

const preySpawner = (x: number, y: number): number | undefined => {
  const entity = world.entities.createWith([
    [position, { x, y }],
    [previousPosition, { x, y }],
    [velocity, randomVelocity()],
    [prey],
    [reproductionTimer, { value: 0 }],
  ]);
  if (entity === undefined) {
    addLog(`Failed to create prey entity!`);
    return;
  }
  return entity;
};

const spawnEntities = (count: number, spawner: (x: number, y: number) => number | undefined): void => {
  for (let i = 0; i < count; i++) {
    spawner(Math.random() * WIDTH, Math.random() * HEIGHT);
  }
};

spawnEntities(PREDATOR_SPAWN_COUNT, predatorSpawner);
spawnEntities(PREY_SPAWN_COUNT, preySpawner);

// ############################################################################
// QUERIES
// ############################################################################

// Keyed Query maps give systems typed component records (preferred over array QuerySpecs).
const movementQuery = new Query({
  all: { position, velocity },
});

const previousPositionQuery = new Query({
  all: { position, previousPosition },
});

const predatorQuery = new Query({
  all: { position, velocity, previousPosition, predator, energy },
});
const preyQuery = new Query({
  all: { position, velocity, previousPosition, prey, reproductionTimer },
});

// ############################################################################
// HELPER FUNCTIONS
// ############################################################################

const distance = (x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
};

const findNearestInScratch = (
  currentX: number,
  currentY: number,
  count: number,
  detectionRange: number,
): { index: number; distance: number } => {
  let nearestIndex = -1;
  let nearestDistance = detectionRange;

  for (let i = 0; i < count; i++) {
    const dist = distance(currentX, currentY, scratchX[i]!, scratchY[i]!);
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearestIndex = i;
    }
  }

  return { index: nearestIndex, distance: nearestDistance };
};

const applyWanderBehavior = (velX: number, velY: number): { x: number; y: number } => {
  let newVelX = velX + (Math.random() - 0.5) * WANDER_CHANGE_RATE;
  let newVelY = velY + (Math.random() - 0.5) * WANDER_CHANGE_RATE;

  const currentSpeed = Math.sqrt(newVelX * newVelX + newVelY * newVelY);

  if (currentSpeed < MIN_WANDER_SPEED) {
    if (currentSpeed > 0.01) {
      newVelX = (newVelX / currentSpeed) * MIN_WANDER_SPEED;
      newVelY = (newVelY / currentSpeed) * MIN_WANDER_SPEED;
    } else {
      const angle = Math.random() * Math.PI * 2;
      newVelX = Math.cos(angle) * MIN_WANDER_SPEED;
      newVelY = Math.sin(angle) * MIN_WANDER_SPEED;
    }
  }

  return { x: newVelX, y: newVelY };
};

const moveTowardsTarget = (
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  speed: number,
  targetDistance: number,
): { x: number; y: number } => {
  if (targetDistance > 0) {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    return {
      x: (dx / targetDistance) * speed,
      y: (dy / targetDistance) * speed,
    };
  }
  return { x: 0, y: 0 };
};

const moveAwayFromTarget = (
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  speed: number,
  targetDistance: number,
): { x: number; y: number } => {
  if (targetDistance > 0) {
    const dx = currentX - targetX;
    const dy = currentY - targetY;
    return {
      x: (dx / targetDistance) * speed,
      y: (dy / targetDistance) * speed,
    };
  }
  return { x: 0, y: 0 };
};

const capVelocity = (vx: number, vy: number): { x: number; y: number } => {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > MAX_VELOCITY) {
    return { x: (vx / speed) * MAX_VELOCITY, y: (vy / speed) * MAX_VELOCITY };
  }
  return { x: vx, y: vy };
};

// ############################################################################
// SYSTEMS
// ############################################################################

// Systems receive a dense BorrowedEntityList: use `.indices` (slots) for SoA,
// and `.entities` (packed handles) for identity APIs like destroy / isActive.

// Predator AI: Chase nearest prey
const predatorAISystem = new System({
  name: "predatorAI",
  query: predatorQuery,
  callback: (components, entities) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const velocityX = components.velocity.storage.partitions.x;
    const velocityY = components.velocity.storage.partitions.y;
    const preyCount = gatherPositions(preyQuery);

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      const px = positionX[slot]!;
      const py = positionY[slot]!;
      const { index, distance: nearestDistance } = findNearestInScratch(
        px,
        py,
        preyCount,
        PREDATOR_DETECTION_RANGE,
      );

      if (index >= 0) {
        const next = moveTowardsTarget(
          px,
          py,
          scratchX[index]!,
          scratchY[index]!,
          PREDATOR_SPEED,
          nearestDistance,
        );
        velocityX[slot] = next.x;
        velocityY[slot] = next.y;
      } else {
        const next = applyWanderBehavior(velocityX[slot]!, velocityY[slot]!);
        velocityX[slot] = next.x;
        velocityY[slot] = next.y;
      }
    }
  },
});

// Prey AI: Flee from nearest predator
const preyAISystem = new System({
  name: "preyAI",
  query: preyQuery,
  callback: (components, entities) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const velocityX = components.velocity.storage.partitions.x;
    const velocityY = components.velocity.storage.partitions.y;
    const predatorCount = gatherPositions(predatorQuery);

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      const px = positionX[slot]!;
      const py = positionY[slot]!;
      const { index, distance: nearestDistance } = findNearestInScratch(
        px,
        py,
        predatorCount,
        PREY_DETECTION_RANGE,
      );

      if (index >= 0) {
        const next = moveAwayFromTarget(
          px,
          py,
          scratchX[index]!,
          scratchY[index]!,
          PREY_SPEED,
          nearestDistance,
        );
        velocityX[slot] = next.x;
        velocityY[slot] = next.y;
      } else {
        const next = applyWanderBehavior(velocityX[slot]!, velocityY[slot]!);
        velocityX[slot] = next.x;
        velocityY[slot] = next.y;
      }
    }
  },
});

// Separation system - prevents entities from occupying the same space
const separationSystem = new System({
  name: "separation",
  query: movementQuery,
  callback: (components, entities, dt: number) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const velocityX = components.velocity.storage.partitions.x;
    const velocityY = components.velocity.storage.partitions.y;
    const count = entities.count;
    const indices = entities.indices;

    // Snapshot positions into scratch (same pattern as cross-query gathers).
    for (let i = 0; i < count; i++) {
      const slot = indices[i]!;
      scratchX[i] = positionX[slot]!;
      scratchY[i] = positionY[slot]!;
    }

    for (let i = 0; i < count; i++) {
      let separationX = 0;
      let separationY = 0;
      let neighborCount = 0;
      const ax = scratchX[i]!;
      const ay = scratchY[i]!;

      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const dx = ax - scratchX[j]!;
        const dy = ay - scratchY[j]!;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < SEPARATION_DISTANCE && dist > 0.01) {
          const force = (SEPARATION_DISTANCE - dist) / dist;
          separationX += dx * force;
          separationY += dy * force;
          neighborCount++;
        }
      }

      if (neighborCount === 0) continue;

      const slot = indices[i]!;
      const dx = separationX * dt * SEPARATION_FORCE;
      const dy = separationY * dt * SEPARATION_FORCE;
      const capped = capVelocity(velocityX[slot]! + dx, velocityY[slot]! + dy);
      velocityX[slot] = capped.x;
      velocityY[slot] = capped.y;
      positionX[slot] = positionX[slot]! + dx * dt;
      positionY[slot] = positionY[slot]! + dy * dt;
    }
  },
});

const movementSystem = new System({
  name: "movement",
  query: movementQuery,
  callback: (components, entities, dt: number) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const velocityX = components.velocity.storage.partitions.x;
    const velocityY = components.velocity.storage.partitions.y;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      let x = positionX[slot]! + velocityX[slot]! * dt;
      let y = positionY[slot]! + velocityY[slot]! * dt;
      let vx = velocityX[slot]!;
      let vy = velocityY[slot]!;

      if (x < 0) {
        x = 0;
        vx = -vx;
      } else if (x >= WIDTH) {
        x = WIDTH - 1;
        vx = -vx;
      }

      if (y < 0) {
        y = 0;
        vy = -vy;
      } else if (y >= HEIGHT) {
        y = HEIGHT - 1;
        vy = -vy;
      }

      positionX[slot] = x;
      positionY[slot] = y;
      velocityX[slot] = vx;
      velocityY[slot] = vy;
    }
  },
});

const interpolatePosition = (prev: number, current: number, alpha: number): number => {
  return prev + (current - prev) * alpha;
};

const renderPredatorSystem = new System({
  name: "renderPredator",
  query: predatorQuery,
  callback: (components, entities, alpha: number) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const prevX = components.previousPosition.storage.partitions.x;
    const prevY = components.previousPosition.storage.partitions.y;
    const energyValue = components.energy.storage.partitions.value;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      const energyPercent = (energyValue[slot]! / PREDATOR_MAX_ENERGY) * 100;
      const char = energyPercent < 30 ?
        PREDATOR_CHAR_LOW :
        energyPercent > 80 ?
        PREDATOR_CHAR_HIGH :
        PREDATOR_CHAR_NORMAL;

      placeOnGrid(
        interpolatePosition(prevX[slot]!, positionX[slot]!, alpha),
        interpolatePosition(prevY[slot]!, positionY[slot]!, alpha),
        char,
      );
    }
  },
});

const renderPreySystem = new System({
  name: "renderPrey",
  query: preyQuery,
  callback: (components, entities, alpha: number) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const prevX = components.previousPosition.storage.partitions.x;
    const prevY = components.previousPosition.storage.partitions.y;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      placeOnGrid(
        interpolatePosition(prevX[slot]!, positionX[slot]!, alpha),
        interpolatePosition(prevY[slot]!, positionY[slot]!, alpha),
        PREY_CHAR,
      );
    }
  },
});

// Collision detection and eating
const collisionSystem = new System({
  name: "collision",
  query: predatorQuery,
  callback: (components, entities) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const energyValue = components.energy.storage.partitions.value;
    const preyCount = gatherPositions(preyQuery);
    takenScratch.fill(0, 0, preyCount);
    let destroyCount = 0;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      const px = positionX[slot]!;
      const py = positionY[slot]!;

      for (let j = 0; j < preyCount; j++) {
        if (takenScratch[j]) continue;
        const dist = distance(px, py, scratchX[j]!, scratchY[j]!);
        if (dist < COLLISION_DISTANCE) {
          energyValue[slot] = Math.min(
            energyValue[slot]! + PREDATOR_ENERGY_GAIN_FROM_PREY,
            PREDATOR_MAX_ENERGY,
          );
          takenScratch[j] = 1;
          destroyScratch[destroyCount++] = scratchEntities[j]!;
          if (VERBOSE) {
            addLog(`Predator ${entities.entities[i]!} ate prey ${scratchEntities[j]!}`);
          }
          break;
        }
      }
    }

    batchDestroyEntities(destroyScratch, destroyCount);
  },
});

// Predator energy loss and starvation
const predatorEnergySystem = new System({
  name: "predatorEnergy",
  query: predatorQuery,
  callback: (components, entities, dt: number) => {
    const energyValue = components.energy.storage.partitions.value;
    let destroyCount = 0;

    for (let i = 0; i < entities.count; i++) {
      const entity = entities.entities[i]!;
      const slot = entities.indices[i]!;
      let value = energyValue[slot]! - PREDATOR_ENERGY_LOSS_PER_SECOND * dt;

      if (!Number.isFinite(value)) {
        addLog(`[${entity}] CRITICAL: Energy became ${value}!`);
        destroyScratch[destroyCount++] = entity;
        continue;
      }

      energyValue[slot] = value;
      if (value <= PREDATOR_STARVATION_THRESHOLD) {
        destroyScratch[destroyCount++] = entity;
        addLog(`Predator ${entity} starved! Energy: ${value.toFixed(2)}`);
      }
    }

    if (destroyCount > 0) {
      addLog(`Removing ${destroyCount} predator(s)`);
      batchDestroyEntities(destroyScratch, destroyCount);
    }
  },
});

// Prey reproduction
const preyReproductionSystem = new System({
  name: "preyReproduction",
  query: preyQuery,
  callback: (components, entities, dt: number) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const reproTimer = components.reproductionTimer.storage.partitions.value;
    const preyCount = entities.count;

    if (preyCount < PREY_MIN_POPULATION_FOR_REPRODUCTION) {
      return;
    }

    // Snapshot before any spawn: queryList views are invalidated by world mutations.
    for (let i = 0; i < preyCount; i++) {
      const slot = entities.indices[i]!;
      scratchEntities[i] = entities.entities[i]!;
      scratchX[i] = positionX[slot]!;
      scratchY[i] = positionY[slot]!;
    }

    for (let i = 0; i < preyCount; i++) {
      const entity = scratchEntities[i]!;
      const slot = entityIndex(entity);
      let timer = reproTimer[slot]! + dt;
      reproTimer[slot] = timer;

      if (timer < PREY_REPRODUCTION_COOLDOWN) continue;

      let foundMate = false;
      const myX = scratchX[i]!;
      const myY = scratchY[i]!;
      for (let j = 0; j < preyCount; j++) {
        if (i === j) continue;
        if (distance(myX, myY, scratchX[j]!, scratchY[j]!) < PREY_REPRODUCTION_DISTANCE) {
          foundMate = true;
          break;
        }
      }

      if (!foundMate || world.entities.getAvailableCount() === 0) {
        reproTimer[slot] = PREY_REPRODUCTION_COOLDOWN / 2;
        continue;
      }

      const newPrey = preySpawner(
        myX + (Math.random() - 0.5) * 2,
        myY + (Math.random() - 0.5) * 2,
      );

      if (newPrey !== undefined) {
        reproTimer[slot] = 0;
        if (VERBOSE) {
          addLog(`Prey ${entity} reproduced, created ${newPrey}`);
        }
      } else {
        reproTimer[slot] = PREY_REPRODUCTION_COOLDOWN / 2;
      }
    }
  },
});

const updatePreviousPositionSystem = new System({
  name: "updatePreviousPosition",
  query: previousPositionQuery,
  callback: (components, entities) => {
    const positionX = components.position.storage.partitions.x;
    const positionY = components.position.storage.partitions.y;
    const prevX = components.previousPosition.storage.partitions.x;
    const prevY = components.previousPosition.storage.partitions.y;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      prevX[slot] = positionX[slot]!;
      prevY[slot] = positionY[slot]!;
    }
  },
});

// Initialize systems in a world like so:
const predatorAI = world.systems.create(predatorAISystem);
const preyAI = world.systems.create(preyAISystem);
const separation = world.systems.create(separationSystem);
const movement = world.systems.create(movementSystem);
const collision = world.systems.create(collisionSystem);
const predatorEnergy = world.systems.create(predatorEnergySystem);
const preyReproduction = world.systems.create(preyReproductionSystem);
const renderPrey = world.systems.create(renderPreySystem);
const renderPredator = world.systems.create(renderPredatorSystem);
const updatePreviousPosition = world.systems.create(updatePreviousPositionSystem);

// ############################################################################
// GAME LOOP - not Miski specific
// ############################################################################

let running = true;
let lastTime = 0;
let accumulator = 0;
let frameCount = 0;
let fpsTime = 0;
let fps = 0;

function gameLoop(currentTime: number = performance.now()): void {
  if (!running) return;

  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  accumulator += deltaTime;

  // Calculate FPS
  frameCount++;
  fpsTime += deltaTime;
  if (fpsTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    fpsTime = 0;
  }

  let updates = 0;
  while (accumulator >= FIXED_TIME_STEP && updates < MAX_UPDATES) {
    // world.frame runs the tick then refreshes entered/exited/changed state.
    world.frame(() => {
      updatePreviousPosition();

      // AI behavior
      predatorAI();
      preyAI();

      // Physics - separation must run before movement
      separation(FIXED_TIME_STEP / 1000);
      movement(FIXED_TIME_STEP / 1000);

      // Game logic
      collision();
      predatorEnergy(FIXED_TIME_STEP / 1000);
      preyReproduction(FIXED_TIME_STEP / 1000);
    });

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

  // Continue the game loop
  setTimeout(() => gameLoop(performance.now()), FIXED_TIME_STEP);
}

// Start the game loop after initialization
lastTime = performance.now();
setTimeout(() => gameLoop(performance.now()), FIXED_TIME_STEP);
