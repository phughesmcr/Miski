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

  // Count entities by type using queries and show predator energy
  let predators = 0;
  let prey = 0;
  let predatorEnergyDisplay = "";

  const energyInstance = world.components.getInstance(energy);

  for (const predEntity of world.archetypes.queryEntities(predatorQuery)) {
    predators++;
    if (energyInstance) {
      energyInstance.proxy.entity = predEntity;
      predatorEnergyDisplay += `[${predEntity}: ${energyInstance.proxy.value.toFixed(1)}] `;
    }
  }

  for (const _ of world.archetypes.queryEntities(preyQuery)) prey++;

  const total = predators + prey;

  console.log(`Predators: ${predators} | Prey: ${prey} | Total: ${total} | FPS: ${fps}`);
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

const position = new Component({
  name: "position",
  schema: schemaVec2,
});

const previousPosition = new Component({
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

// ############################################################################
// HELPERS
// ############################################################################

// Helper to safely destroy an entity
const safeDestroyEntity = (entity: number): boolean => {
  const isValid = world.entities.isEntity(entity);
  const isActive = world.entities.isActive(entity);
  addLog(`  Entity ${entity}: isEntity=${isValid}, isActive=${isActive}`);

  try {
    if (isActive) {
      world.entities.destroy(entity);
      addLog(`  ✓ Entity ${entity} destroyed successfully`);
      return true;
    } else {
      addLog(`  ⚠ Entity ${entity} not active (already destroyed?)`);
    }
  } catch (error) {
    addLog(`  ✗ Failed to destroy ${entity}: ${error}`);
  }
  return false;
};

// ############################################################################
// ENTITIES
// ############################################################################

const creatureSpawner = (x: number, y: number) => {
  const entity = world.entities.create();
  if (entity === undefined) {
    addLog(`⚠ Failed to create creature entity!`);
    return;
  }
  addLog(`➕ Created entity ${entity}, isActive: ${world.entities.isActive(entity)}`);
  world.components.addToEntity(position, entity, { x, y });
  world.components.addToEntity(previousPosition, entity, { x, y });
  world.components.addToEntity(velocity, entity, {
    x: (Math.random() - 0.5) * VELOCITY_SCALAR * 2,
    y: (Math.random() - 0.5) * VELOCITY_SCALAR * 2,
  });
  return entity;
};

const predatorSpawner = (x: number, y: number) => {
  const entity = creatureSpawner(x, y);
  if (entity === undefined) return;
  world.components.addToEntity(predator, entity);
  world.components.addToEntity(energy, entity, { value: PREDATOR_INITIAL_ENERGY });
  if (VERBOSE) {
    addLog(`🎯 Created predator entity ${entity}`);
  }
  return entity;
};

const preySpawner = (x: number, y: number) => {
  const entity = creatureSpawner(x, y);
  if (entity === undefined) return;
  world.components.addToEntity(prey, entity);
  world.components.addToEntity(reproductionTimer, entity, { value: 0 });
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

// QUERIES
// Queries are used to select entities that have certain components.
// They are defined by the `Query` class.

const movementQuery = new Query({
  all: [position, velocity],
});

const previousPositionQuery = new Query({
  all: [position, previousPosition],
});

const predatorQuery = new Query({ all: [position, velocity, previousPosition, predator, energy] });
const preyQuery = new Query({ all: [position, velocity, previousPosition, prey, reproductionTimer] });

// ############################################################################
// SYSTEMS
// ############################################################################

// Systems are functions that are executed on a set of entities.
// They are defined by the `System` class.
// Systems are executed in the order they are added to the world.

// ############################################################################
// HELPER FUNCTIONS
// ############################################################################

type Vec2Data = { x: number; y: number };
type EntityPosition = { entity: number; x: number; y: number };

const distance = (x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
};

const gatherEntityPositions = (query: Query, includeEntity = false): Vec2Data[] | EntityPosition[] => {
  const posInstance = world.components.getInstance(position)!;
  const positions: Array<Vec2Data | EntityPosition> = [];

  for (const entity of world.entities.query(query)) {
    posInstance.proxy.entity = entity;
    const pos = includeEntity
      ? { entity, x: posInstance.proxy.x, y: posInstance.proxy.y }
      : { x: posInstance.proxy.x, y: posInstance.proxy.y };
    positions.push(pos);
  }

  return positions;
};

const findNearestTarget = <T extends Vec2Data>(
  currentX: number,
  currentY: number,
  targets: T[],
  detectionRange: number,
): { target: T | null; distance: number } => {
  let nearestTarget = null;
  let nearestDistance = detectionRange;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    const dist = distance(currentX, currentY, target.x, target.y);
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearestTarget = target;
    }
  }

  return { target: nearestTarget, distance: nearestDistance };
};

const applyWanderBehavior = (velX: number, velY: number): Vec2Data => {
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
): Vec2Data => {
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
): Vec2Data => {
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

// Predator AI: Chase nearest prey
const predatorAISystem = new System({
  name: "predatorAI",
  query: predatorQuery,
  callback: (components, entities) => {
    const { proxy: predatorPos } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: predatorVel } = components["velocity"] as ComponentInstance<Vec2>;

    const preyPositions = gatherEntityPositions(preyQuery, true) as EntityPosition[];

    for (const predatorEntity of entities) {
      predatorPos.entity = predatorEntity;
      predatorVel.entity = predatorEntity;

      const { target: nearestPrey, distance: nearestDistance } = findNearestTarget(
        predatorPos.x,
        predatorPos.y,
        preyPositions,
        PREDATOR_DETECTION_RANGE,
      );

      if (nearestPrey !== null) {
        const velocity = moveTowardsTarget(
          predatorPos.x,
          predatorPos.y,
          nearestPrey.x,
          nearestPrey.y,
          PREDATOR_SPEED,
          nearestDistance,
        );
        predatorVel.x = velocity.x;
        predatorVel.y = velocity.y;
      } else {
        const velocity = applyWanderBehavior(predatorVel.x, predatorVel.y);
        predatorVel.x = velocity.x;
        predatorVel.y = velocity.y;
      }
    }
  },
});

// Prey AI: Flee from nearest predator
const preyAISystem = new System({
  name: "preyAI",
  query: preyQuery,
  callback: (components, entities) => {
    const { proxy: preyPos } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: preyVel } = components["velocity"] as ComponentInstance<Vec2>;

    const predatorPositions = gatherEntityPositions(predatorQuery, false) as Vec2Data[];

    for (const preyEntity of entities) {
      preyPos.entity = preyEntity;
      preyVel.entity = preyEntity;

      const { target: nearestPredator, distance: nearestDistance } = findNearestTarget(
        preyPos.x,
        preyPos.y,
        predatorPositions,
        PREY_DETECTION_RANGE,
      );

      if (nearestPredator !== null) {
        const velocity = moveAwayFromTarget(
          preyPos.x,
          preyPos.y,
          nearestPredator.x,
          nearestPredator.y,
          PREY_SPEED,
          nearestDistance,
        );
        preyVel.x = velocity.x;
        preyVel.y = velocity.y;
      } else {
        const velocity = applyWanderBehavior(preyVel.x, preyVel.y);
        preyVel.x = velocity.x;
        preyVel.y = velocity.y;
      }
    }
  },
});

// Separation system - prevents entities from occupying the same space
const separationSystem = new System({
  name: "separation",
  query: movementQuery,
  callback: (components, entities, dt: number) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: velocity } = components["velocity"] as ComponentInstance<Vec2>;

    // Build spatial index of all entity positions
    const entityPositions: Array<{ entity: number; x: number; y: number }> = [];
    for (const entity of entities) {
      position.entity = entity;
      entityPositions.push({
        entity,
        x: position.x,
        y: position.y,
      });
    }

    // Store separation adjustments
    const adjustments = new Map<number, { dx: number; dy: number }>();

    // Calculate separation forces
    for (let i = 0; i < entityPositions.length; i++) {
      const entityA = entityPositions[i]!;
      let separationX = 0;
      let separationY = 0;
      let neighborCount = 0;

      // Check against all other entities
      for (let j = 0; j < entityPositions.length; j++) {
        if (i === j) continue;

        const entityB = entityPositions[j]!;
        const dx = entityA.x - entityB.x;
        const dy = entityA.y - entityB.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If too close, add separation force
        if (dist < SEPARATION_DISTANCE && dist > 0.01) {
          // Separation force increases as distance decreases
          const force = (SEPARATION_DISTANCE - dist) / dist;
          separationX += dx * force;
          separationY += dy * force;
          neighborCount++;
        }
      }

      // Store adjustments
      if (neighborCount > 0) {
        adjustments.set(entityA.entity, {
          dx: separationX * dt * SEPARATION_FORCE,
          dy: separationY * dt * SEPARATION_FORCE,
        });
      }
    }

    // Apply adjustments to both velocity and position for immediate effect
    for (const [entity, adjustment] of adjustments) {
      position.entity = entity;
      velocity.entity = entity;

      // Apply to velocity for gradual push
      velocity.x += adjustment.dx;
      velocity.y += adjustment.dy;

      // Cap velocity to prevent extreme speeds
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
      if (speed > MAX_VELOCITY) {
        velocity.x = (velocity.x / speed) * MAX_VELOCITY;
        velocity.y = (velocity.y / speed) * MAX_VELOCITY;
      }

      // Apply directly to position for immediate separation
      position.x += adjustment.dx * dt;
      position.y += adjustment.dy * dt;
    }
  },
});

const movementSystem = new System({
  name: "movement",
  query: movementQuery,
  callback: (components, entities, dt: number) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: velocity } = components["velocity"] as ComponentInstance<Vec2>;

    for (const entity of entities) {
      position.entity = entity;
      velocity.entity = entity;

      position.x += velocity.x * dt;
      position.y += velocity.y * dt;

      // boundary checks with canvas dimensions
      if (position.x < 0) {
        position.x = 0;
        velocity.x = -velocity.x;
      } else if (position.x >= WIDTH) {
        position.x = WIDTH - 1;
        velocity.x = -velocity.x;
      }

      if (position.y < 0) {
        position.y = 0;
        velocity.y = -velocity.y;
      } else if (position.y >= HEIGHT) {
        position.y = HEIGHT - 1;
        velocity.y = -velocity.y;
      }
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
    const { proxy: pos } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: prevPos } = components["previousPosition"] as ComponentInstance<Vec2>;
    const { proxy: energyProxy } = components["energy"] as ComponentInstance<Energy>;

    for (const entity of entities) {
      pos.entity = entity;
      prevPos.entity = entity;
      energyProxy.entity = entity;

      const energyPercent = (energyProxy.value / PREDATOR_MAX_ENERGY) * 100;
      const char = energyPercent < 30
        ? PREDATOR_CHAR_LOW
        : energyPercent > 80
        ? PREDATOR_CHAR_HIGH
        : PREDATOR_CHAR_NORMAL;

      placeOnGrid(
        interpolatePosition(prevPos.x, pos.x, alpha),
        interpolatePosition(prevPos.y, pos.y, alpha),
        char,
      );
    }
  },
});

const renderPreySystem = new System({
  name: "renderPrey",
  query: preyQuery,
  callback: (components, entities, alpha: number) => {
    const { proxy: pos } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: prevPos } = components["previousPosition"] as ComponentInstance<Vec2>;

    for (const entity of entities) {
      pos.entity = entity;
      prevPos.entity = entity;
      placeOnGrid(
        interpolatePosition(prevPos.x, pos.x, alpha),
        interpolatePosition(prevPos.y, pos.y, alpha),
        PREY_CHAR,
      );
    }
  },
});

// Collision detection and eating
const collisionSystem = new System({
  name: "collision",
  query: predatorQuery,
  callback: (components) => {
    const { proxy: predatorPos } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: predatorEnergy } = components["energy"] as ComponentInstance<Energy>;

    const preyToRemove = new Set<number>();
    const preyEntities = gatherEntityPositions(preyQuery, true) as EntityPosition[];

    for (const predatorEntity of world.entities.query(predatorQuery)) {
      predatorPos.entity = predatorEntity;
      predatorEnergy.entity = predatorEntity;

      for (let i = 0; i < preyEntities.length; i++) {
        const preyData = preyEntities[i]!;

        if (preyToRemove.has(preyData.entity)) continue;

        const dist = distance(predatorPos.x, predatorPos.y, preyData.x, preyData.y);

        if (dist < COLLISION_DISTANCE) {
          predatorEnergy.value = Math.min(
            predatorEnergy.value + PREDATOR_ENERGY_GAIN_FROM_PREY,
            PREDATOR_MAX_ENERGY,
          );
          preyToRemove.add(preyData.entity);

          if (VERBOSE) {
            addLog(`🍽 Predator ${predatorEntity} ate prey ${preyData.entity}`);
          }

          break;
        }
      }
    }

    batchDestroyEntities(preyToRemove);
  },
});

const batchDestroyEntities = (entities: Set<number>): void => {
  for (const entity of entities) {
    safeDestroyEntity(entity);
  }
};

const countEntitiesInQuery = (query: Query): number => {
  let count = 0;
  for (const _ of world.entities.query(query)) {
    count++;
  }
  return count;
};

// Predator energy loss and starvation
const predatorEnergySystem = new System({
  name: "predatorEnergy",
  query: predatorQuery,
  callback: (components, entities, dt: number) => {
    const { proxy: energyProxy } = components["energy"] as ComponentInstance<Energy>;
    const predatorsToRemove = new Set<number>();

    for (const entity of entities) {
      energyProxy.entity = entity;
      energyProxy.value -= PREDATOR_ENERGY_LOSS_PER_SECOND * dt;

      // Check for NaN or invalid values
      if (isNaN(energyProxy.value) || !isFinite(energyProxy.value)) {
        addLog(`✗ [${entity}] CRITICAL: Energy became ${energyProxy.value}!`);
        predatorsToRemove.add(entity);
        continue;
      }

      if (energyProxy.value <= PREDATOR_STARVATION_THRESHOLD) {
        predatorsToRemove.add(entity);
        addLog(`☠ Predator ${entity} starved! Energy: ${energyProxy.value.toFixed(2)}`);
      }
    }

    if (predatorsToRemove.size > 0) {
      addLog(`→ Removing ${predatorsToRemove.size} predator(s): ${Array.from(predatorsToRemove).join(", ")}`);
    }
    batchDestroyEntities(predatorsToRemove);
  },
});

// Prey reproduction
const preyReproductionSystem = new System({
  name: "preyReproduction",
  query: preyQuery,
  callback: (components, entities, dt: number) => {
    const { proxy: preyPos } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: reproTimer } = components["reproductionTimer"] as ComponentInstance<ReproductionTimer>;

    // Check if there are enough prey for reproduction
    const preyCount = countEntitiesInQuery(preyQuery);
    if (preyCount < PREY_MIN_POPULATION_FOR_REPRODUCTION) {
      return; // Not enough prey to reproduce
    }

    for (const entity of entities) {
      preyPos.entity = entity;
      reproTimer.entity = entity;

      // Update reproduction timer
      reproTimer.value += dt;

      // Check if ready to reproduce
      if (reproTimer.value >= PREY_REPRODUCTION_COOLDOWN) {
        // Look for nearby prey
        let foundMate = false;

        for (const otherEntity of world.entities.query(preyQuery)) {
          if (otherEntity === entity) continue;

          preyPos.entity = otherEntity;
          const otherX = preyPos.x;
          const otherY = preyPos.y;

          preyPos.entity = entity;
          const myX = preyPos.x;
          const myY = preyPos.y;

          const dist = distance(myX, myY, otherX, otherY);

          if (dist < PREY_REPRODUCTION_DISTANCE) {
            foundMate = true;
            break;
          }
        }

        // If mate found, try to spawn new prey with small offset to avoid overlapping
        if (foundMate) {
          // Check if we have capacity before spawning
          if (world.entities.getAvailableCount() > 0) {
            preyPos.entity = entity;
            const newPrey = preySpawner(
              preyPos.x + (Math.random() - 0.5) * 2,
              preyPos.y + (Math.random() - 0.5) * 2,
            );

            if (newPrey !== undefined) {
              reproTimer.value = 0; // Only reset on successful reproduction
              if (VERBOSE) {
                addLog(`🐣 Prey ${entity} reproduced, created ${newPrey}`);
              }
            } else {
              // Failed to spawn - retry in half the cooldown time
              reproTimer.value = PREY_REPRODUCTION_COOLDOWN / 2;
            }
          } else {
            // No capacity available - retry in half the cooldown time
            reproTimer.value = PREY_REPRODUCTION_COOLDOWN / 2;
          }
        } else {
          // No mate found - retry in half the cooldown time
          reproTimer.value = PREY_REPRODUCTION_COOLDOWN / 2;
        }
      }
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
      position.entity = entity;
      previousPosition.entity = entity;
      previousPosition.x = position.x;
      previousPosition.y = position.y;
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
    updatePreviousPosition();

    // AI behavior
    predatorAI();
    preyAI();

    // Physics - separation must run before movement
    separation(FIXED_TIME_STEP / 1000);
    movement(FIXED_TIME_STEP / 1000); // Convert to seconds

    // Game logic
    collision();
    predatorEnergy(FIXED_TIME_STEP / 1000);
    preyReproduction(FIXED_TIME_STEP / 1000);

    // Refresh world state for query tracking and change detection
    world.refresh();

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
