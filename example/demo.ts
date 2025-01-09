/// <reference lib="dom" />
/**
 * @module shooter
 * @description A simple vertical shooter game using Miski and Canvas2D.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

// The only imports we need:
import { Component, type Entity, Query, type Schema, System, World } from "../mod.ts";
import { Webview } from "jsr:@webview/webview";

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
    const { proxy: position }: ComponentInstance<Vec2> = components["position"]!;
    const { proxy: velocity }: ComponentInstance<Vec2> = components["velocity"]!;

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
    const { proxy: position }: ComponentInstance<Vec2> = components["position"]!;
    const { proxy: velocity }: ComponentInstance<Vec2> = components["velocity"]!;

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
    const { proxy: position }: ComponentInstance<Vec2> = components["position"]!;

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
    const { proxy: position }: ComponentInstance<Vec2> = components["position"]!;

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

// Remove direct DOM manipulation and replace with WebView setup
const HTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { 
            margin: 0;
            overflow: hidden;
            background: black;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        canvas {
            background: #111;
        }
    </style>
</head>
<body>
    <canvas width="800" height="600"></canvas>
    <script>
        const canvas = document.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        
        // Expose canvas context to main thread
        window.ctx = ctx;
        
        // Handle window resize
        function resizeCanvas() {
            const scale = Math.min(
                window.innerWidth / 800,
                window.innerHeight / 600
            );
            canvas.style.transform = \`scale(\${scale})\`;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();
    </script>
</body>
</html>
`;

// Create and setup WebView window
const window = new Webview();

// Initialize the window with our HTML
window.navigate(`data:text/html,${encodeURIComponent(HTML)}`);

// Get canvas context from WebView
let ctx: CanvasRenderingContext2D;
window.bind("getContext", () => {
  return window.eval("ctx");
});
ctx = (await window.eval("ctx")) as unknown as CanvasRenderingContext2D;

// Create system instances
const movement = world.systems.create(movementSystem);
const ai = world.systems.create(aiSystem);
const collision = world.systems.create(collisionSystem);
const render = world.systems.create(renderSystem);

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
    Math.random() * canvas.width,
    Math.random() * canvas.height,
  );
}

for (let i = 0; i < 10; i++) {
  spawnPrey(
    Math.random() * canvas.width,
    Math.random() * canvas.height,
  );
}

// ############################################################################
// GAME LOOP
// ############################################################################

let lastTime = 0;
let running = true;

async function gameLoop(timestamp: number) {
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  movement(dt);
  ai();
  collision();
  render(ctx);

  if (running) {
    // Schedule next frame through WebView
    window.eval(`requestAnimationFrame(${gameLoop.toString()})`);
  }
}

// Start the game loop
window.eval(`requestAnimationFrame(${gameLoop.toString()})`);

// Show the window and start the event loop
window.show();
window.run();

// Cleanup when window closes
// window.destroy();
// running = false;
