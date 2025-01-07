/// <reference lib="dom" />
/**
 * @module shooter
 * @description A simple vertical shooter game using Miski and Canvas2D.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

// The only imports we need:
import {
  Component,
  type ComponentInstance,
  type ComponentRecord,
  type Entity,
  Query,
  System,
  type,
  World,
} from "../mod.ts";

// ############################################################################
// MISC
// ############################################################################

const sprites: Map<number, HTMLImageElement> = new Map();

// ############################################################################
// COMPONENTS
// ############################################################################

// For type safety, we can define a type for the schema of our components, but this is optional.
type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

const velocity = new Component<Vec2>({
  name: "velocity",
  schema: {
    x: Float32Array,
    y: Float32Array,
  },
});

// for DRY purposes, we can define a schema for a vector2.
const vec2Schema = {
  x: Float32Array,
  y: Float32Array,
};

const position = new Component<Vec2>({
  name: "position",
  schema: vec2Schema,
});

/**
 * Single component to mark an entity as predator or prey.
 * 0 -> Predator
 * 1 -> Prey
 */
const state = new Component<{ value: Uint8ArrayConstructor }>({
  name: "state",
  schema: {
    value: Uint8Array,
  },
});

// ############################################################################
// WORLD
// ############################################################################

// Now that we have our components, we can create our world.
// First, you need to decide what the maximum number of entities you need will be.
// Pass this number to the World constructor as the `capacity` parameter.
// THIS CANNOT BE CHANGED LATER.
const world = new World({
  capacity: 1024,
  components: [
    velocity,
    position,
    state,
  ],
});

// ############################################################################
// SYSTEMS
// ############################################################################

// QUERIES
// Queries are used to select entities that have certain components.
// They are defined by the `Query` class.

// Systems are functions that are executed on a set of entities.
// They are defined by the `System` class.
// Systems are executed in the order they are added to the world.

const movementSystem = new System({
  query: new Query({ all: [velocity, position] }),
  callback: (components: ComponentRecord<any>, entities: IterableIterator<number>, dt: number) => {
    const { proxy: position }: ComponentInstance<Vec2> = components["position"]!;
    const { proxy: velocity }: ComponentInstance<Vec2> = components["velocity"]!;
    for (const entity of entities) {
      // set the cursors to the entity
      position.cursor = entity;
      velocity.cursor = entity;

      // update the position
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;

      // boundary checks
      if (position.x < 0) {
        position.x = 0;
        velocity.x = -velocity.x;
      } else if (position.x > 100) {
        position.x = 100;
        velocity.x = -velocity.x;
      }

      if (position.y < 0) {
        position.y = 0;
        velocity.y = -velocity.y;
      } else if (position.y > 100) {
        position.y = 100;
        velocity.y = -velocity.y;
      }
    }
  },
});

world.systems.create<Record<(movementSystem);

const findClosest = (components: ComponentRecord<any>, entities: IterableIterator<Entity>, dt: number) => {
};

const predatorSystem = new System({
  query: new Query({ all: [state, position, velocity] }),
  callback: (components: ComponentRecord<any>, entities: IterableIterator<Entity>, dt: number) => {
    const { proxy: state }: ComponentInstance<{ value: Uint8ArrayConstructor }> = components["state"]!;
    const { proxy: position }: ComponentInstance<Vec2> = components["position"]!;
    const { proxy: velocity }: ComponentInstance<Vec2> = components["velocity"]!;

    for (const entity of entities) {
      state.cursor = entity;
      position.cursor = entity;
      velocity.cursor = entity;

      switch (state.value) {
        case 0:
          const { x, y } = position;
          const { x: vx, y: vy } = velocity;

          break;
        case 1:
          break;
      }
    }
  },
});

/**
 * PredatorSystem:
 * For each predator (state.value=0), move velocity toward the nearest prey (state.value=1).
 */
function predatorSystem(
  components: ComponentRecord<any>,
  entities: IterableIterator<Entity>,
  dt: number,
): void {
  // Collect predator and prey entity IDs
  const predatorIds: number[] = [];
  const preyIds: number[] = [];

  // First pass: separate predators from prey
  for (const entityId of entities) {
    if (!components["state"].has(entityId)) continue;
    if (!components["position"].has(entityId)) continue;
    if (!components["velocity"].has(entityId)) continue;

    const s = components["state"].get(entityId) as { value: number };
    if (s.value === 0) {
      predatorIds.push(entityId);
    } else if (s.value === 1) {
      preyIds.push(entityId);
    }
  }

  // For each predator, find the closest prey and adjust velocity
  for (const predatorId of predatorIds) {
    const predatorPos = components["position"].get(predatorId) as Vec2;
    const predatorVel = components["velocity"].get(predatorId) as Vec2;

    let closestPrey = -1;
    let minDist = Infinity;

    for (const preyId of preyIds) {
      const preyPos = components["position"].get(preyId) as Vec2;
      const dx = preyPos.x - predatorPos.x;
      const dy = preyPos.y - predatorPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
        closestPrey = preyId;
      }
    }

    if (closestPrey >= 0) {
      // Set velocity toward that prey
      const closestPreyPos = components["position"].get(closestPrey) as Vec2;
      const dx = closestPreyPos.x - predatorPos.x;
      const dy = closestPreyPos.y - predatorPos.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length > 0) {
        predatorVel.x = (dx / length) * 1.0; // Speed factor
        predatorVel.y = (dy / length) * 1.0;
      }
    }
  }
}

/**
 * PreySystem:
 * For each prey (state.value=1), move velocity away from the nearest predator (state.value=0).
 */
function preySystem(
  entities: IterableIterator<number>,
  components: Record<string, Component>,
  dt: number,
): void {
  // Collect predator and prey entity IDs
  const predatorIds: number[] = [];
  const preyIds: number[] = [];

  // First pass: separate predators from prey
  for (const entityId of entities) {
    if (!components["state"].has(entityId)) continue;
    if (!components["position"].has(entityId)) continue;
    if (!components["velocity"].has(entityId)) continue;

    const s = components["state"].get(entityId) as { value: number };
    if (s.value === 0) {
      predatorIds.push(entityId);
    } else if (s.value === 1) {
      preyIds.push(entityId);
    }
  }

  // For each prey, find the closest predator and adjust velocity
  for (const preyId of preyIds) {
    const preyPos = components["position"].get(preyId) as Vec2;
    const preyVel = components["velocity"].get(preyId) as Vec2;

    let closestPredator = -1;
    let minDist = Infinity;

    for (const predatorId of predatorIds) {
      const predatorPos = components["position"].get(predatorId) as Vec2;
      const dx = predatorPos.x - preyPos.x;
      const dy = predatorPos.y - preyPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
        closestPredator = predatorId;
      }
    }

    if (closestPredator >= 0) {
      const cpPos = components["position"].get(closestPredator) as Vec2;
      const dx = preyPos.x - cpPos.x;
      const dy = preyPos.y - cpPos.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length > 0) {
        // Move away from predator
        preyVel.x = (dx / length) * 0.8; // Speed factor
        preyVel.y = (dy / length) * 0.8;
      }
    }
  }
}
