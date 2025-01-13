/// <reference lib="dom" />
/**
 * @module demo
 * @description A predator-prey simulation using Miski and Canvas2D.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

// The only Miski imports we need:
import { Component, type ComponentInstance, type Entity, Query, type Schema, System, World } from "../mod.ts";

// Import Webview to display the simulation in a window
import { SizeHint, Webview } from "jsr:@webview/webview";

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
const vec2Schema: Schema<Vec2> = {
  x: Float32Array,
  y: Float32Array,
};

const position = new Component<Vec2>({
  name: "position",
  schema: vec2Schema,
});

// Tags are components that have no schema / data.
const predator = new Component<null>({ name: "predator" });
const prey = new Component<null>({ name: "prey" });

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
    predator,
    prey,
  ],
});

// Initialize the world before use
await world.init();

// Spawn initial entities
function spawnPredator(x: number, y: number) {
  const entity = world.entities.create();
  if (entity === undefined) return;

  world.components.addToEntity(position, entity, { x, y });
  world.components.addToEntity(velocity, entity, { x: 0, y: 0 });
  world.components.addToEntity(predator, entity);
}

function spawnPrey(x: number, y: number) {
  const entity = world.entities.create();
  if (entity === undefined) return;

  world.components.addToEntity(position, entity, { x, y });
  world.components.addToEntity(velocity, entity, { x: 0, y: 0 });
  world.components.addToEntity(prey, entity);
}

// Initial spawn
for (let i = 0; i < 3; i++) {
  spawnPredator(
    Math.random() * 800,
    Math.random() * 600,
  );
}

for (let i = 0; i < 10; i++) {
  spawnPrey(
    Math.random() * 800,
    Math.random() * 600,
  );
}

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
  name: "movement",
  query: new Query({ all: [velocity, position] }),
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
      } else if (position.x > 800) {
        position.x = 800;
        velocity.x = -velocity.x;
      }

      if (position.y < 0) {
        position.y = 0;
        velocity.y = -velocity.y;
      } else if (position.y > 600) {
        position.y = 600;
        velocity.y = -velocity.y;
      }
    }
  },
});

const aiSystem = new System({
  name: "ai",
  query: new Query({ all: [position, velocity], any: [predator, prey] }),
  callback: (components, entities) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;
    const { proxy: velocity } = components["velocity"] as ComponentInstance<Vec2>;

    // Store all positions first for performance
    const positions = new Map<Entity, [number, number, boolean]>();

    for (const entity of entities) {
      position.cursor = entity;
      positions.set(entity, [
        position.x,
        position.y,
        world.components.entityOwns(predator, entity),
      ]);
    }

    // Update velocities based on positions
    for (const entity of entities) {
      position.cursor = entity;
      velocity.cursor = entity;

      const isPredator = world.components.entityOwns(predator, entity);
      const [myX, myY] = [position.x, position.y];

      let closestDist = Infinity;
      let targetX = myX;
      let targetY = myY;

      // Find closest target
      for (const [otherEntity, [x, y, isPred]] of positions) {
        if (otherEntity === entity) continue;
        if (isPred === isPredator) continue;

        const dx = x - myX;
        const dy = y - myY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < closestDist) {
          closestDist = dist;
          targetX = x;
          targetY = y;
        }
      }

      if (closestDist !== Infinity) {
        const dx = targetX - myX;
        const dy = targetY - myY;
        const angle = Math.atan2(dy, dx);

        const speed = isPredator ? 150 : 100;
        velocity.x = Math.cos(angle) * speed;
        velocity.y = Math.sin(angle) * speed;

        if (!isPredator) {
          velocity.x *= -1;
          velocity.y *= -1;
        }
      }
    }
  },
});

const collisionSystem = new System({
  name: "collision",
  query: new Query({ all: [position], any: [predator, prey] }),
  callback: (components, entities) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;

    const positions = new Map<Entity, [number, number, boolean]>();

    // Gather positions
    for (const entity of entities) {
      position.cursor = entity;
      positions.set(entity, [
        position.x,
        position.y,
        world.components.entityOwns(predator, entity),
      ]);
    }

    // Check collisions
    for (const [entity1, [x1, y1, isPred1]] of positions) {
      for (const [entity2, [x2, y2, isPred2]] of positions) {
        if (entity1 === entity2) continue;
        if (isPred1 === isPred2) continue;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 30) { // collision radius
          if (isPred1) {
            world.entities.destroy(entity2); // predator catches prey
          } else {
            world.entities.destroy(entity1);
          }
        }
      }
    }
  },
});

const renderSystem = new System({
  name: "render",
  query: new Query({ all: [position], any: [predator, prey] }),
  callback: (components, entities, ctx: CanvasRenderingContext2D) => {
    const { proxy: position } = components["position"] as ComponentInstance<Vec2>;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (const entity of entities) {
      position.cursor = entity;

      ctx.beginPath();
      ctx.arc(position.x, position.y, 15, 0, Math.PI * 2);

      if (world.components.entityOwns(predator, entity)) {
        ctx.fillStyle = "red";
      } else {
        ctx.fillStyle = "green";
      }

      ctx.fill();
      ctx.closePath();
    }
  },
});

// ############################################################################
// SETUP
// ############################################################################

const HTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body { 
            overflow: hidden;
            background: black;
            height: 100vh;
            width: 100vw;
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        canvas {
            background: #111;
            display: block;
            height: 600px;
            width: 800px;
        }
    </style>
</head>
<body>
    <canvas width="800" height="600"></canvas>
    <script>
        const canvas = document.querySelector('canvas');
        const ctx = canvas.getContext('2d');
       
        window.addEventListener('load', () => {
          globalThis.ctx = ctx;
          getContext(canvas);
        });
    </script>
</body>
</html>
`;

// Create and setup WebView window
const window = new Webview(true, {
  width: 800 * 2,
  height: 600 * 2,
  hint: SizeHint.NONE,
});
window.title = "🍬 Miski Demo";

// Get canvas context from WebView
let ctx: CanvasRenderingContext2D | null = null;
window.bind("getContext", (canvas: HTMLCanvasElement) => {
  ctx = canvas.getContext("2d")!;
  return ctx;
});
window.bind("getWorld", () => world);

// Create system instances AFTER entities exist
/* const movement = world.systems.create(movementSystem);
const ai = world.systems.create(aiSystem);
const collision = world.systems.create(collisionSystem);
const render = world.systems.create(renderSystem); */

// ############################################################################
// GAME LOOP
// ############################################################################

let lastTime = 0;
let running = true;

async function gameLoop(timestamp: number) {
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  console.log(dt);
}

window.bind("frame", (timestamp: number) => {
  if (!ctx) return;
  gameLoop(timestamp);
  window.eval(`requestAnimationFrame(frame)`);
});

// Show the window and start the event loop
window.navigate(`data:text/html,${encodeURIComponent(HTML)}`);
window.run();

// Cleanup when window closes
window.destroy();
running = false;

console.dir(world);
