/// <reference lib="dom" />
/// <reference lib="deno.ns" />

/**
 * @module visual-demo
 * @description A live browser visualization powered by a Miski ECS simulation.
 *
 * The simulation runs here, in Deno, at a fixed 60 Hz. Browsers connect over a WebSocket and receive
 * compact binary entity frames (30 Hz) plus a small JSON status message (4 Hz); the client interpolates
 * and draws everything with WebGL2.
 *
 * What it shows off:
 * - SoA system loops over `queryList` slots (steering, flocking fields, movement, lifetimes).
 * - Archetype churn: drones gain and lose a `charge` component as excitation waves spread through
 *   the swarm. `queryEntered` / `queryExited` on the charged query drive the ember effects and metrics.
 * - Rollback: "Forecast" captures a rollback point, simulates up to a second ahead, records where
 *   drones will go, then restores. When the future arrives the demo measures how far reality drifted
 *   from the forecast; with no user input in between it should be exactly 0.
 *
 * Flags: `--port <n>` (or first positional), `--drones <n>`, `--seed <n>`, `--profile-frames <n>`.
 *
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

import {
  captureWorldRollbackPoint,
  Component,
  type Entity,
  entityIndex,
  Query,
  type QueryEntityList,
  restoreWorldRollbackPoint,
  System,
  World,
} from "../mod.ts";
import htmlTemplate from "./visual/index.html" with { type: "text" };
import clientSource from "./visual/client.js" with { type: "text" };
import stylesheet from "./visual/style.css" with { type: "text" };
import type { DemoCommand, DemoHello, DemoMode, DemoStatus } from "./visual/contracts.ts";

// --- Configuration -----------------------------------------------------------------------------

const CAPACITY = 40_960;
const DEFAULT_DRONES = 4_096;
const MIN_DRONES = 256;
const MAX_DRONES = 32_768;
const DRONE_STEP = 256;
const MAX_SPARKS = CAPACITY - MAX_DRONES;
const WORLD_WIDTH = 1_920;
const WORLD_HEIGHT = 1_080;
const TEAM_COUNT = 4;
const TEAM_HUES = [188, 12, 46, 268] as const;
const EMBER_HUE = 38;

const SIMULATION_FPS = 60;
const SIMULATION_STEP_SECONDS = 1 / SIMULATION_FPS;
const SIMULATION_STEP_MS = 1_000 / SIMULATION_FPS;
const MAX_ACCUMULATED_SIMULATION_MS = SIMULATION_STEP_MS * 5;
const SNAPSHOT_HZ = 30;
const SNAPSHOT_INTERVAL_MS = 1_000 / SNAPSHOT_HZ;
const STATUS_INTERVAL_MS = 250;
const GC_SAMPLE_INTERVAL = 120;

/** Flocking works on per-cell aggregates, so cost is O(drones + cells) rather than O(drones * neighbours). */
const CELL_SIZE = 48;
const GRID_W = Math.ceil(WORLD_WIDTH / CELL_SIZE);
const GRID_H = Math.ceil(WORLD_HEIGHT / CELL_SIZE);
const CELL_COUNT = GRID_W * GRID_H;

const CHARGE_SECONDS = 0.8;
const REFRACTORY_SECONDS = 2.4;
const SPREAD_RATE = 4.5;
const SPONTANEOUS_IGNITIONS_PER_SECOND = 0.8;
const EMBERS_PER_STEP = 48;
const PULSE_SECONDS = 1.8;

const FORECAST_SAMPLE_EVERY = 3;
const FORECAST_MAX_STEPS = 60;
const FORECAST_MIN_STEPS = 12;
const FORECAST_BUDGET_MS = 10;
const FORECAST_INTERVAL_MS = 100;
const FORECAST_ENTITIES = 160;
const FORECAST_MAX_SAMPLES = FORECAST_MAX_STEPS / FORECAST_SAMPLE_EVERY;

/**
 * Binary frame layout (little-endian).
 * Header (48 bytes): u32 magic, u32 frame, u32 entityCount, u32 forecastEntities, u32 forecastSamples,
 *   f32 pulseX, f32 pulseY, f32 pulseStrength, f32 attractX, f32 attractY, f32 attractStrength, f32 time.
 * Entities (16 bytes each): u32 handle, u16 x*32, u16 y*32, u8 hue, u8 size*16, u8 alpha, u8 energy,
 *   u8 kind, u8 team, u8 glow, u8 reserved.
 * Forecast: forecastEntities * forecastSamples * (u16 x*32, u16 y*32), grouped by entity.
 */
const FRAME_MAGIC = 0x314b534d; // "MSK1"
const HEADER_BYTES = 48;
const ENTITY_BYTES = 16;
const POSITION_SCALE = 32;
const FRAME_BYTES = HEADER_BYTES + CAPACITY * ENTITY_BYTES + FORECAST_ENTITIES * FORECAST_MAX_SAMPLES * 4;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const numericArg = (flag: string, fallback?: string): number | undefined => {
  const index = Deno.args.findIndex((arg) => arg === flag);
  const raw = index === -1 ? fallback : Deno.args[index + 1];
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) ? value : undefined;
};

const snapDrones = (value: number): number =>
  clamp(Math.round(value / DRONE_STEP) * DRONE_STEP, MIN_DRONES, MAX_DRONES);

const PORT = numericArg("--port", Deno.args[0]?.startsWith("--") ? undefined : Deno.args[0]) ?? 8080;
const profileFrames = Math.max(0, Math.round(numericArg("--profile-frames") ?? 0));
let desiredDroneCount = snapDrones(numericArg("--drones") ?? DEFAULT_DRONES);

// --- Components, world, queries ----------------------------------------------------------------

const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array } });
const velocity = new Component({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
const visual = new Component({
  name: "visual",
  schema: {
    hue: Float32Array,
    radius: Float32Array,
    alpha: Float32Array,
    energy: Float32Array,
    glow: Float32Array,
    team: Uint8Array,
    kind: Uint8Array,
  },
});
const brain = new Component({
  name: "brain",
  schema: { orbit: Float32Array, bias: Float32Array, drag: Float32Array, rest: Float32Array },
});
const lifetime = new Component({ name: "lifetime", schema: { age: Float32Array, ttl: Float32Array } });
/** Added when a drone ignites, removed when it burns out: the archetype churn the demo visualises. */
const charge = new Component({ name: "charge", schema: { level: Float32Array } });
const drone = new Component<null>({ name: "drone" });
const spark = new Component<null>({ name: "spark" });

const world = new World({
  capacity: CAPACITY,
  components: [position, velocity, visual, brain, lifetime, charge, drone, spark],
});

await world.init();

const { partitions: positionStore } = world.components.require(position).storage;
const { partitions: visualStore } = world.components.require(visual).storage;

const droneQuery = new Query({ all: { position, velocity, visual, brain, drone } });
const chargedQuery = new Query({ all: { visual, charge, drone } });
const sparkQuery = new Query({ all: { position, velocity, visual, lifetime, spark } });
const movementQuery = new Query({ all: { position, velocity, visual } });
const renderQuery = new Query({ all: { position, visual } });

// --- Simulation state --------------------------------------------------------------------------

/** Everything outside the ECS that a step reads or writes. Saved and restored around forecasts. */
type SimState = {
  frame: number;
  time: number;
  rng: number;
  pulseX: number;
  pulseY: number;
  pulseAge: number;
  spawned: number;
  destroyed: number;
  liveSparks: number;
  ignited: number;
  spent: number;
};

const sim: SimState = {
  frame: 0,
  time: 0,
  rng: (numericArg("--seed") ?? Date.now()) >>> 0,
  pulseX: WORLD_WIDTH * 0.5,
  pulseY: WORLD_HEIGHT * 0.5,
  pulseAge: 99,
  spawned: 0,
  destroyed: 0,
  liveSparks: 0,
  ignited: 0,
  spent: 0,
};
const simSaved: SimState = { ...sim };

let mode: DemoMode = "orbit";
let running = true;
let intensity = 1;
let contagion = 1;
let forecastEnabled = true;
let attractX = WORLD_WIDTH * 0.5;
let attractY = WORLD_HEIGHT * 0.5;
let attractStrength = 0;

let lastTickMs = 0;
let averageStepMs = 0.2;
let forecastStepMs = 0.2;
let heapUsedMb = 0;
let lastFrameBytes = 0;
let accumulatedSimulationMs = 0;
let previousSimulationFrameMs = performance.now();
let nextSnapshotAt = 0;
let nextStatusAt = 0;
let nextForecastAt = 0;
let statusWindowStartedAt = performance.now();
let statusWindowIgnited = 0;
let statusWindowSpent = 0;
let ignitedPerSec = 0;
let spentPerSec = 0;
/** The socket currently holding the pointer gravity well, so its disconnect can release it. */
let attractOwner: WebSocket | undefined;

/** Seeded mulberry32, so forecasts replay exactly what the real run will do. */
const rand = (): number => {
  let t = (sim.rng = (sim.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const random = (min: number, max: number): number => min + rand() * (max - min);

// Scratch buffers, allocated once.
const expiredScratch = new Uint32Array(CAPACITY);
const emberScratch = new Uint32Array(EMBERS_PER_STEP);
const igniteList = { count: 0, entities: new Uint32Array(MAX_DRONES), slots: new Uint32Array(MAX_DRONES) };
const burnoutList = { count: 0, entities: new Uint32Array(MAX_DRONES), slots: new Uint32Array(MAX_DRONES) };
const targetXByTeam = new Float32Array(TEAM_COUNT);
const targetYByTeam = new Float32Array(TEAM_COUNT);

const cellCount = new Float32Array(CELL_COUNT);
const cellSumX = new Float32Array(CELL_COUNT);
const cellSumY = new Float32Array(CELL_COUNT);
const cellSumVX = new Float32Array(CELL_COUNT);
const cellSumVY = new Float32Array(CELL_COUNT);
const cellCharged = new Float32Array(CELL_COUNT);
// Blurred per-cell fields, sampled bilinearly at cell centres so forces vary smoothly (no grid lock-in).
const fieldDensity = new Float32Array(CELL_COUNT);
const fieldMeanX = new Float32Array(CELL_COUNT);
const fieldMeanY = new Float32Array(CELL_COUNT);
const fieldMeanVX = new Float32Array(CELL_COUNT);
const fieldMeanVY = new Float32Array(CELL_COUNT);
const fieldCharged = new Float32Array(CELL_COUNT);

const cellOf = (x: number, y: number): number => {
  const cx = Math.min(GRID_W - 1, Math.max(0, (x / CELL_SIZE) | 0));
  const cy = Math.min(GRID_H - 1, Math.max(0, (y / CELL_SIZE) | 0));
  return cx + cy * GRID_W;
};

const modeWeights = (current: DemoMode): { target: number; flock: number; maxSpeed: number } => {
  switch (current) {
    case "storm":
      return { target: 1, flock: 0.35, maxSpeed: 520 };
    case "lattice":
      return { target: 1, flock: 0.15, maxSpeed: 360 };
    case "flock":
      return { target: 0.2, flock: 1, maxSpeed: 300 };
    default:
      return { target: 1, flock: 0.45, maxSpeed: 380 };
  }
};

// --- Spawning ----------------------------------------------------------------------------------

const spawnDrone = (x: number, y: number, team: number): void => {
  const speed = random(35, 130);
  const angle = random(0, Math.PI * 2);
  const hue = TEAM_HUES[team] ?? TEAM_HUES[0];
  const entity = world.entities.createWith([
    [position, { x, y }],
    [velocity, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }],
    [visual, {
      hue: hue + random(-10, 10),
      radius: random(2.1, 4.6),
      alpha: random(0.6, 0.92),
      energy: random(0.35, 1),
      glow: 0,
      team,
      kind: 0,
    }],
    [brain, {
      orbit: random(-1, 1),
      bias: random(0.15, 1),
      drag: random(0.955, 0.99),
      rest: random(0, REFRACTORY_SECONDS),
    }],
    [drone],
  ]);
  if (entity !== undefined) sim.spawned++;
};

const spawnSpark = (x: number, y: number, hue: number, strength: number, ttl: number): void => {
  if (sim.liveSparks >= MAX_SPARKS) return;
  const angle = random(0, Math.PI * 2);
  const speed = random(115, 520) * strength;
  const entity = world.entities.createWith([
    [position, { x, y }],
    [velocity, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }],
    [visual, {
      hue: hue + random(-12, 12),
      radius: random(1.4, 4.8) * strength,
      alpha: random(0.52, 0.95),
      energy: random(0.2, 1),
      glow: 0,
      team: 4,
      kind: 1,
    }],
    [lifetime, { age: 0, ttl }],
    [spark],
  ]);
  if (entity === undefined) return;
  sim.spawned++;
  sim.liveSparks++;
};

const burst = (x: number, y: number, count: number, hue: number): void => {
  sim.pulseX = x;
  sim.pulseY = y;
  sim.pulseAge = 0;
  for (let i = 0; i < count; i++) {
    spawnSpark(x + random(-12, 12), y + random(-12, 12), hue, random(0.65, 1.45), random(0.55, 1.8));
  }
};

// --- Systems -----------------------------------------------------------------------------------

/** Bin drones into a coarse grid, then box-blur each cell with its 8 neighbours into mean fields. */
const fieldSystem = world.systems.create(
  new System({
    name: "fieldSystem",
    query: droneQuery,
    callback: (components, drones) => {
      cellCount.fill(0);
      cellSumX.fill(0);
      cellSumY.fill(0);
      cellSumVX.fill(0);
      cellSumVY.fill(0);
      cellCharged.fill(0);
      const slots = drones.slots;
      const count = drones.count;
      const px = components.position.storage.partitions.x;
      const py = components.position.storage.partitions.y;
      const vx = components.velocity.storage.partitions.x;
      const vy = components.velocity.storage.partitions.y;
      const glow = components.visual.storage.partitions.glow;
      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const x = px[slot]!;
        const y = py[slot]!;
        const cell = cellOf(x, y);
        cellCount[cell]!++;
        cellSumX[cell]! += x;
        cellSumY[cell]! += y;
        cellSumVX[cell]! += vx[slot]!;
        cellSumVY[cell]! += vy[slot]!;
        if (glow[slot]! > 0.35) cellCharged[cell]!++;
      }
      for (let cy = 0; cy < GRID_H; cy++) {
        for (let cx = 0; cx < GRID_W; cx++) {
          let n = 0, sx = 0, sy = 0, svx = 0, svy = 0, ch = 0;
          for (let oy = Math.max(0, cy - 1); oy <= Math.min(GRID_H - 1, cy + 1); oy++) {
            for (let ox = Math.max(0, cx - 1); ox <= Math.min(GRID_W - 1, cx + 1); ox++) {
              const c = ox + oy * GRID_W;
              n += cellCount[c]!;
              sx += cellSumX[c]!;
              sy += cellSumY[c]!;
              svx += cellSumVX[c]!;
              svy += cellSumVY[c]!;
              ch += cellCharged[c]!;
            }
          }
          const cell = cx + cy * GRID_W;
          const inverse = n > 0 ? 1 / n : 0;
          fieldDensity[cell] = n;
          fieldMeanX[cell] = n > 0 ? sx * inverse : (cx + 0.5) * CELL_SIZE;
          fieldMeanY[cell] = n > 0 ? sy * inverse : (cy + 0.5) * CELL_SIZE;
          fieldMeanVX[cell] = svx * inverse;
          fieldMeanVY[cell] = svy * inverse;
          fieldCharged[cell] = ch * inverse;
        }
      }
    },
  }),
);

type Column = { [index: number]: number };

const ignite = (entity: number, slot: number, rest: Column, glow: Column): void => {
  rest[slot] = CHARGE_SECONDS + REFRACTORY_SECONDS * random(0.8, 1.25);
  glow[slot] = 1;
  igniteList.entities[igniteList.count] = entity;
  igniteList.slots[igniteList.count] = slot;
  igniteList.count++;
};

/** Team targets + flocking + pulse/attractor forces, and charge contagion. */
const steeringSystem = world.systems.create(
  new System({
    name: "steeringSystem",
    query: droneQuery,
    callback: (components, drones, dt: number, time: number) => {
      const cx = WORLD_WIDTH * 0.5;
      const cy = WORLD_HEIGHT * 0.5;
      const currentMode = mode;
      const weights = modeWeights(currentMode);
      const targetWeight = weights.target * intensity;
      const flockWeight = weights.flock;
      const pulseAge = sim.pulseAge;
      const pulsePower = Math.max(0, 1 - pulseAge / PULSE_SECONDS);
      const pulseX = sim.pulseX;
      const pulseY = sim.pulseY;
      const pulseRadius = 60 + pulseAge * 470;
      const attractPower = attractStrength;
      const spread = contagion * SPREAD_RATE * dt;

      if (currentMode === "lattice") {
        for (let team = 0; team < TEAM_COUNT; team++) {
          const phase = team * Math.PI * 0.5;
          targetXByTeam[team] = Math.sin(time + phase) * 32;
          targetYByTeam[team] = Math.cos(time * 0.7 + phase) * 26;
        }
      } else if (currentMode === "storm") {
        for (let team = 0; team < TEAM_COUNT; team++) {
          targetXByTeam[team] = time * (0.95 + team * 0.08);
          targetYByTeam[team] = time * (0.82 + team * 0.11);
        }
      } else {
        const radiusScale = currentMode === "flock" ? 1.2 : 1;
        for (let team = 0; team < TEAM_COUNT; team++) {
          const phase = team * Math.PI * 0.5;
          targetXByTeam[team] = cx + Math.cos(time * 0.22 + phase) * (330 + team * 42) * radiusScale;
          targetYByTeam[team] = cy + Math.sin(time * 0.27 + phase) * (185 + team * 28) * radiusScale;
        }
      }

      const slots = drones.slots;
      const entities = drones.entities;
      const count = drones.count;
      // Blurred 3x3 density a uniformly spread swarm would have.
      const inverseExpectedDensity = CELL_COUNT / Math.max(1, count * 9);
      const positionX = components.position.storage.partitions.x;
      const positionY = components.position.storage.partitions.y;
      const velocityX = components.velocity.storage.partitions.x;
      const velocityY = components.velocity.storage.partitions.y;
      const visualAlpha = components.visual.storage.partitions.alpha;
      const visualEnergy = components.visual.storage.partitions.energy;
      const visualGlow = components.visual.storage.partitions.glow;
      const visualTeam = components.visual.storage.partitions.team;
      const brainOrbit = components.brain.storage.partitions.orbit;
      const brainBias = components.brain.storage.partitions.bias;
      const brainDrag = components.brain.storage.partitions.drag;
      const brainRest = components.brain.storage.partitions.rest;
      igniteList.count = 0;

      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const x = positionX[slot]!;
        const y = positionY[slot]!;
        const vx = velocityX[slot]!;
        const vy = velocityY[slot]!;
        const team = visualTeam[slot]!;
        const orbit = brainOrbit[slot]!;
        const bias = brainBias[slot]!;
        const glow = visualGlow[slot]!;

        let targetX = targetXByTeam[team]!;
        let targetY = targetYByTeam[team]!;
        if (currentMode === "storm") {
          targetX = cx + Math.cos(targetX + orbit * 5) * (120 + team * 95);
          targetY = cy + Math.sin(targetY - orbit * 4) * (90 + team * 80);
        } else if (currentMode === "lattice") {
          targetX = cx + (((slot * 37) % 14) - 6.5) * 118 + targetX;
          targetY = cy + (((slot * 19) % 9) - 4) * 94 + targetY;
        }

        // Steer towards the team target, orbiting it.
        const dx = targetX - x;
        const dy = targetY - y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const inverseDistance = 1 / distance;
        const pull = clamp(distance / 620, 0.08, 1.55) * targetWeight;
        let ax = dx * inverseDistance * pull * 22 - dy * inverseDistance * orbit * 34 * bias * targetWeight;
        let ay = dy * inverseDistance * pull * 22 + dx * inverseDistance * orbit * 34 * bias * targetWeight;

        // Flocking from the blurred field: cohesion, alignment, and separation down the density gradient.
        const fx = x / CELL_SIZE - 0.5;
        const fy = y / CELL_SIZE - 0.5;
        let ix = Math.floor(fx);
        let iy = Math.floor(fy);
        let tx = fx - ix;
        let ty = fy - iy;
        if (ix < 0) {
          ix = 0;
          tx = 0;
        } else if (ix > GRID_W - 2) {
          ix = GRID_W - 2;
          tx = 1;
        }
        if (iy < 0) {
          iy = 0;
          ty = 0;
        } else if (iy > GRID_H - 2) {
          iy = GRID_H - 2;
          ty = 1;
        }
        const c00 = ix + iy * GRID_W;
        const c10 = c00 + 1;
        const c01 = c00 + GRID_W;
        const c11 = c01 + 1;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        // Every sampled field is continuous in position. (A density *gradient* here is piecewise constant per
        // cell and traps drones on cell-centre lines, so crowding instead flips cohesion into repulsion.)
        const density = fieldDensity[c00]! * w00 + fieldDensity[c10]! * w10 + fieldDensity[c01]! * w01 +
          fieldDensity[c11]! * w11;
        const crowding = Math.min(3, density * inverseExpectedDensity);
        const gather = 0.05 - crowding * 0.04;
        const meanX = fieldMeanX[c00]! * w00 + fieldMeanX[c10]! * w10 + fieldMeanX[c01]! * w01 + fieldMeanX[c11]! * w11;
        const meanY = fieldMeanY[c00]! * w00 + fieldMeanY[c10]! * w10 + fieldMeanY[c01]! * w01 + fieldMeanY[c11]! * w11;
        const meanVX = fieldMeanVX[c00]! * w00 + fieldMeanVX[c10]! * w10 + fieldMeanVX[c01]! * w01 +
          fieldMeanVX[c11]! * w11;
        const meanVY = fieldMeanVY[c00]! * w00 + fieldMeanVY[c10]! * w10 + fieldMeanVY[c01]! * w01 +
          fieldMeanVY[c11]! * w11;
        ax += flockWeight * ((meanX - x) * gather + (meanVX - vx) * 0.07);
        ay += flockWeight * ((meanY - y) * gather + (meanVY - vy) * 0.07);

        // Pulse shockwave.
        const pdx = x - pulseX;
        const pdy = y - pulseY;
        const pulseDistance = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
        const pulseRing = Math.max(0, 1 - Math.abs(pulseDistance - pulseRadius) / 130) * pulsePower;
        if (pulseRing > 0) {
          ax += pdx / pulseDistance * pulseRing * 285;
          ay += pdy / pulseDistance * pulseRing * 285;
        }

        // Pointer gravity well (negative strength repels), with a swirl.
        if (attractPower !== 0) {
          const adx = attractX - x;
          const ady = attractY - y;
          const attractDistance = Math.sqrt(adx * adx + ady * ady) || 1;
          const force = attractPower * 6_000 / (attractDistance + 70);
          ax += (adx - ady * 0.55) / attractDistance * force;
          ay += (ady + adx * 0.55) / attractDistance * force;
        }

        const drag = brainDrag[slot]!;
        let nextVX = vx * drag + ax;
        let nextVY = vy * drag + ay;
        const maxSpeed = weights.maxSpeed * (1 + glow * 0.55);
        let speed = Math.sqrt(nextVX * nextVX + nextVY * nextVY);
        if (speed > maxSpeed) {
          const scale = maxSpeed / speed;
          nextVX *= scale;
          nextVY *= scale;
          speed = maxSpeed;
        }
        velocityX[slot] = nextVX;
        velocityY[slot] = nextVY;

        const energy = clamp(speed / maxSpeed + pulseRing * 0.65, 0.12, 1.3);
        visualEnergy[slot] = energy;
        visualAlpha[slot] = clamp(0.45 + energy * 0.42, 0.35, 1);

        // Contagion: excitable-medium rules. Charged neighbours, or the pulse front, ignite rested drones.
        const rest = brainRest[slot]!;
        if (rest > 0) {
          brainRest[slot] = rest - dt;
        } else if (pulseRing > 0.55) {
          ignite(entities[i]!, slot, brainRest, visualGlow);
        } else {
          const charged = fieldCharged[c00]! * w00 + fieldCharged[c10]! * w10 + fieldCharged[c01]! * w01 +
            fieldCharged[c11]! * w11;
          if (charged > 0 && rand() < spread * charged) {
            ignite(entities[i]!, slot, brainRest, visualGlow);
          }
        }
      }

      // A few spontaneous sparks keep waves starting somewhere.
      let sparks = SPONTANEOUS_IGNITIONS_PER_SECOND * contagion * dt + rand();
      while (sparks >= 1 && count > 0) {
        sparks--;
        const i = (rand() * count) | 0;
        const slot = slots[i]!;
        if (brainRest[slot]! <= 0) ignite(entities[i]!, slot, brainRest, visualGlow);
      }

      if (igniteList.count > 0) world.components.addToEntities(charge, igniteList as QueryEntityList, { level: 1 });
      sim.pulseAge += dt;
    },
  }),
);

/** Burn charge down; drones that run out lose the component and leave the charged query. */
const chargeSystem = world.systems.create(
  new System({
    name: "chargeSystem",
    query: chargedQuery,
    callback: (components, charged, dt: number) => {
      const slots = charged.slots;
      const entities = charged.entities;
      const count = charged.count;
      const level = components.charge.storage.partitions.level;
      const glow = components.visual.storage.partitions.glow;
      const decay = dt / CHARGE_SECONDS;
      burnoutList.count = 0;
      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const next = level[slot]! - decay;
        level[slot] = next;
        glow[slot] = Math.max(0, next);
        if (next <= 0) {
          burnoutList.entities[burnoutList.count] = entities[i]!;
          burnoutList.slots[burnoutList.count] = slot;
          burnoutList.count++;
        }
      }
      if (burnoutList.count > 0) world.components.removeFromEntities(charge, burnoutList as QueryEntityList);
    },
  }),
);

const movementSystem = world.systems.create(
  new System({
    name: "movementSystem",
    query: movementQuery,
    callback: (components, movers, dt: number) => {
      const slots = movers.slots;
      const count = movers.count;
      const positionX = components.position.storage.partitions.x;
      const positionY = components.position.storage.partitions.y;
      const velocityX = components.velocity.storage.partitions.x;
      const velocityY = components.velocity.storage.partitions.y;
      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        let x = positionX[slot]! + velocityX[slot]! * dt;
        let y = positionY[slot]! + velocityY[slot]! * dt;
        if (x < 0) {
          velocityX[slot] = velocityX[slot]! * -0.84;
          x = 0;
        } else if (x > WORLD_WIDTH) {
          velocityX[slot] = velocityX[slot]! * -0.84;
          x = WORLD_WIDTH;
        }
        if (y < 0) {
          velocityY[slot] = velocityY[slot]! * -0.84;
          y = 0;
        } else if (y > WORLD_HEIGHT) {
          velocityY[slot] = velocityY[slot]! * -0.84;
          y = WORLD_HEIGHT;
        }
        positionX[slot] = x;
        positionY[slot] = y;
      }
    },
  }),
);

const lifetimeSystem = world.systems.create(
  new System({
    name: "lifetimeSystem",
    query: sparkQuery,
    callback: (components, sparks, dt: number) => {
      const slots = sparks.slots;
      const entities = sparks.entities;
      const count = sparks.count;
      const age = components.lifetime.storage.partitions.age;
      const ttl = components.lifetime.storage.partitions.ttl;
      const visualAlpha = components.visual.storage.partitions.alpha;
      const visualEnergy = components.visual.storage.partitions.energy;
      const visualRadius = components.visual.storage.partitions.radius;
      const velocityX = components.velocity.storage.partitions.x;
      const velocityY = components.velocity.storage.partitions.y;
      let expiredCount = 0;
      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const nextAge = age[slot]! + dt;
        age[slot] = nextAge;
        const progress = nextAge / ttl[slot]!;
        visualAlpha[slot] = Math.max(0, 1 - progress);
        visualEnergy[slot] = Math.max(0, 1 - progress * 0.7);
        visualRadius[slot] = visualRadius[slot]! * 0.993;
        velocityX[slot] = velocityX[slot]! * 0.985;
        velocityY[slot] = velocityY[slot]! * 0.985;
        if (progress >= 1) expiredScratch[expiredCount++] = entities[i]!;
      }
      for (let i = 0; i < expiredCount; i++) {
        world.entities.destroy(expiredScratch[i]! as Entity);
      }
      sim.destroyed += expiredCount;
      sim.liveSparks -= expiredCount;
    },
  }),
);

/** Turn this window's charged-query transitions into embers and counters, then close the window. */
const emitEmbersAndRefresh = (): void => {
  let emberCount = 0;
  let enteredCount = 0;
  const entered = world.entities.queryEntered(chargedQuery);
  for (const entity of entered) {
    if (emberCount < EMBERS_PER_STEP && rand() < 0.35) emberScratch[emberCount++] = entity;
    enteredCount++;
  }
  let exitedCount = 0;
  for (const _entity of world.entities.queryExited(chargedQuery)) exitedCount++;
  sim.ignited += enteredCount;
  sim.spent += exitedCount;
  // Spawn after iterating: the transition iterators are borrowed and invalidated by mutation.
  for (let i = 0; i < emberCount; i++) {
    const slot = entityIndex(emberScratch[i]! as Entity);
    spawnSpark(positionStore.x[slot]!, positionStore.y[slot]!, EMBER_HUE, random(0.25, 0.55), random(0.35, 0.8));
  }
  world.refresh();
};

/** One deterministic simulation step. Used by both the live loop and forecasts. */
const advance = (): void => {
  const dt = SIMULATION_STEP_SECONDS;
  sim.time += dt;
  fieldSystem();
  steeringSystem(dt, sim.time);
  chargeSystem(dt);
  movementSystem(dt);
  lifetimeSystem(dt);
  if (mode === "storm" && sim.frame % 90 === 0) {
    burst(random(260, WORLD_WIDTH - 260), random(190, WORLD_HEIGHT - 190), 55, random(10, 190));
  }
  emitEmbersAndRefresh();
  sim.frame++;
};

const seedWorld = (droneCount = desiredDroneCount): void => {
  // Snapshot before destroy: borrowed getActive() is invalidated by mutations.
  const active = world.entities.getActiveSnapshot();
  for (let i = 0; i < active.length; i++) world.entities.destroy(active[i]!);
  desiredDroneCount = snapDrones(droneCount);
  sim.frame = 0;
  sim.time = 0;
  sim.spawned = 0;
  sim.destroyed = 0;
  sim.liveSparks = 0;
  sim.ignited = 0;
  sim.spent = 0;
  accumulatedSimulationMs = 0;
  previousSimulationFrameMs = performance.now();
  for (let i = 0; i < desiredDroneCount; i++) {
    const team = i % TEAM_COUNT;
    const radius = 120 + team * 75 + random(-45, 145);
    const angle = (i / desiredDroneCount) * Math.PI * 2 * 9 + team * 0.8;
    const x = WORLD_WIDTH * 0.5 + Math.cos(angle) * radius + random(-90, 90);
    const y = WORLD_HEIGHT * 0.5 + Math.sin(angle) * radius * 0.62 + random(-60, 60);
    spawnDrone(clamp(x, 24, WORLD_WIDTH - 24), clamp(y, 24, WORLD_HEIGHT - 24), team);
  }
  burst(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, 110, 184);
  world.refresh();
  forecast.pending = false;
  forecast.entities = 0;
};

// --- Forecast (rollback) -----------------------------------------------------------------------

const forecast = {
  entities: 0,
  samples: 0,
  steps: 0,
  ms: 0,
  /** Quantised forecast paths, entity-major, ready to copy into the frame. */
  paths: new Uint16Array(FORECAST_ENTITIES * FORECAST_MAX_SAMPLES * 2),
  handles: new Uint32Array(FORECAST_ENTITIES),
  slots: new Uint32Array(FORECAST_ENTITIES),
  // Verification: the forecast end state, compared with reality when the frame arrives.
  pending: false,
  disturbed: false,
  verifyFrame: 0,
  verifyHandles: new Uint32Array(FORECAST_ENTITIES),
  verifyX: new Float32Array(FORECAST_ENTITIES),
  verifyY: new Float32Array(FORECAST_ENTITIES),
  verifyCount: 0,
  drift: null as number | null,
};

/**
 * Capture a rollback point, simulate ahead, record sampled drone paths, restore.
 * Restore is observationally neutral, so the live run replays the forecast exactly unless input changes it.
 */
const runForecast = (requestedSteps?: number): void => {
  const drones = world.entities.queryList(droneQuery);
  if (drones.count === 0) return;
  const sampleCount = Math.min(FORECAST_ENTITIES, drones.count);
  const stride = drones.count / sampleCount;
  // Copy out of the borrowed list before any mutation.
  for (let i = 0; i < sampleCount; i++) {
    const index = Math.floor(i * stride);
    forecast.handles[i] = drones.entities[index]!;
    forecast.slots[i] = drones.slots[index]!;
  }
  const budgetSteps = Math.floor(FORECAST_BUDGET_MS / Math.max(0.01, forecastStepMs));
  const steps = Math.floor(
    clamp(requestedSteps ?? budgetSteps, FORECAST_MIN_STEPS, FORECAST_MAX_STEPS) / FORECAST_SAMPLE_EVERY,
  ) * FORECAST_SAMPLE_EVERY;
  const samples = steps / FORECAST_SAMPLE_EVERY;

  const started = performance.now();
  Object.assign(simSaved, sim);
  const point = captureWorldRollbackPoint(world);
  try {
    for (let step = 1; step <= steps; step++) {
      advance();
      if (step % FORECAST_SAMPLE_EVERY !== 0) continue;
      const sample = step / FORECAST_SAMPLE_EVERY - 1;
      for (let i = 0; i < sampleCount; i++) {
        const slot = forecast.slots[i]!;
        const offset = (i * samples + sample) * 2;
        forecast.paths[offset] = positionStore.x[slot]! * POSITION_SCALE;
        forecast.paths[offset + 1] = positionStore.y[slot]! * POSITION_SCALE;
      }
    }
    if (!forecast.pending) {
      forecast.pending = true;
      forecast.disturbed = false;
      forecast.verifyFrame = simSaved.frame + steps;
      forecast.verifyCount = sampleCount;
      for (let i = 0; i < sampleCount; i++) {
        const slot = forecast.slots[i]!;
        forecast.verifyHandles[i] = forecast.handles[i]!;
        forecast.verifyX[i] = positionStore.x[slot]!;
        forecast.verifyY[i] = positionStore.y[slot]!;
      }
    }
  } finally {
    restoreWorldRollbackPoint(world, point);
    Object.assign(sim, simSaved);
  }
  forecast.entities = sampleCount;
  forecast.samples = samples;
  forecast.steps = steps;
  forecast.ms = performance.now() - started;
  forecastStepMs += (forecast.ms / steps - forecastStepMs) * 0.25;
};

const verifyForecast = (): void => {
  if (!forecast.pending || sim.frame < forecast.verifyFrame) return;
  forecast.pending = false;
  if (forecast.disturbed || sim.frame !== forecast.verifyFrame) {
    forecast.drift = null;
    return;
  }
  let total = 0;
  let matched = 0;
  for (let i = 0; i < forecast.verifyCount; i++) {
    const handle = forecast.verifyHandles[i]! as Entity;
    if (!world.entities.isActive(handle)) continue;
    const slot = entityIndex(handle);
    total += Math.hypot(positionStore.x[slot]! - forecast.verifyX[i]!, positionStore.y[slot]! - forecast.verifyY[i]!);
    matched++;
  }
  forecast.drift = matched > 0 ? total / matched : null;
};

/** Any input that changes the simulation's future invalidates the pending forecast check. */
const disturb = (): void => {
  forecast.disturbed = true;
};

// --- Live loop ---------------------------------------------------------------------------------

const step = (): void => {
  const started = performance.now();
  advance();
  verifyForecast();
  if (sim.frame % GC_SAMPLE_INTERVAL === 0) heapUsedMb = Deno.memoryUsage().heapUsed / 1_048_576;
  lastTickMs = performance.now() - started;
  averageStepMs += (lastTickMs - averageStepMs) * 0.05;
};

// --- Wire format -------------------------------------------------------------------------------

const frameBuffer = new ArrayBuffer(FRAME_BYTES);
const frameView = new DataView(frameBuffer);
const frameU32 = new Uint32Array(frameBuffer);
const frameU16 = new Uint16Array(frameBuffer);
const frameBytes = new Uint8ClampedArray(frameBuffer);

/** Pack every rendered entity into the shared frame buffer and return its byte length. */
const encodeFrame = (): number => {
  const list = world.entities.queryList(renderQuery);
  const count = list.count;
  const slots = list.slots;
  const handles = list.entities;
  const px = positionStore.x;
  const py = positionStore.y;
  const { hue, radius, alpha, energy, glow, team, kind } = visualStore;
  for (let i = 0; i < count; i++) {
    const slot = slots[i]!;
    const base = HEADER_BYTES + i * ENTITY_BYTES;
    frameU32[base >> 2] = handles[i]!;
    frameU16[(base >> 1) + 2] = px[slot]! * POSITION_SCALE;
    frameU16[(base >> 1) + 3] = py[slot]! * POSITION_SCALE;
    const h = hue[slot]! % 360;
    frameBytes[base + 8] = ((h < 0 ? h + 360 : h) * 256 / 360) & 255;
    frameBytes[base + 9] = radius[slot]! * 16;
    frameBytes[base + 10] = alpha[slot]! * 255;
    frameBytes[base + 11] = energy[slot]! * 196;
    frameBytes[base + 12] = kind[slot]!;
    frameBytes[base + 13] = team[slot]!;
    frameBytes[base + 14] = glow[slot]! * 255;
  }
  let length = HEADER_BYTES + count * ENTITY_BYTES;
  const forecastEntities = forecastEnabled ? forecast.entities : 0;
  const forecastValues = forecastEntities * forecast.samples * 2;
  if (forecastValues > 0) {
    frameU16.set(forecast.paths.subarray(0, forecastValues), length >> 1);
    length += forecastValues * 2;
  }
  frameView.setUint32(0, FRAME_MAGIC, true);
  frameView.setUint32(4, sim.frame, true);
  frameView.setUint32(8, count, true);
  frameView.setUint32(12, forecastEntities, true);
  frameView.setUint32(16, forecast.samples, true);
  frameView.setFloat32(20, sim.pulseX, true);
  frameView.setFloat32(24, sim.pulseY, true);
  frameView.setFloat32(28, Math.max(0, 1 - sim.pulseAge / PULSE_SECONDS), true);
  frameView.setFloat32(32, attractX, true);
  frameView.setFloat32(36, attractY, true);
  frameView.setFloat32(40, attractStrength, true);
  frameView.setFloat32(44, sim.time, true);
  return length;
};

const round = (value: number, places = 1): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Close the transition-rate window. Called only on the timed status tick, so command echoes don't shrink it. */
const updateRates = (): void => {
  const now = performance.now();
  const seconds = Math.max(0.001, (now - statusWindowStartedAt) / 1_000);
  ignitedPerSec = (sim.ignited - statusWindowIgnited) / seconds;
  spentPerSec = (sim.spent - statusWindowSpent) / seconds;
  statusWindowStartedAt = now;
  statusWindowIgnited = sim.ignited;
  statusWindowSpent = sim.spent;
};

const status = (): DemoStatus => {
  return {
    type: "status",
    mode,
    running,
    intensity,
    contagion,
    forecast: forecastEnabled,
    metrics: {
      active: world.entities.getActiveCount(),
      available: world.entities.getAvailableCount(),
      drones: world.entities.queryList(droneQuery).count,
      sparks: world.entities.queryList(sparkQuery).count,
      charged: world.entities.queryList(chargedQuery).count,
      ignitedPerSec: Math.max(0, Math.round(ignitedPerSec)),
      spentPerSec: Math.max(0, Math.round(spentPerSec)),
      spawned: sim.spawned,
      destroyed: sim.destroyed,
      tickMs: round(averageStepMs, 2),
      heapMb: round(heapUsedMb),
      frameKb: round(lastFrameBytes / 1_024),
      forecastMs: forecastEnabled ? round(forecast.ms) : 0,
      forecastSteps: forecastEnabled ? forecast.steps : 0,
      forecastDrift: forecastEnabled && forecast.drift !== null ? round(forecast.drift, 4) : null,
      droneTarget: desiredDroneCount,
      capacity: CAPACITY,
    },
  };
};

// --- Profiling ---------------------------------------------------------------------------------

const runProfile = (frames: number): void => {
  seedWorld();
  const started = performance.now();
  for (let i = 0; i < frames; i++) step();
  const elapsedMs = performance.now() - started;

  // Determinism self-test: forecast a full horizon, then live-run it and compare.
  forecast.pending = false;
  const forecastStarted = performance.now();
  runForecast(FORECAST_MAX_STEPS);
  const forecastMs = performance.now() - forecastStarted;
  for (let i = 0; i < FORECAST_MAX_STEPS; i++) step();

  const encodeStarted = performance.now();
  const bytes = encodeFrame();
  const encodeMs = performance.now() - encodeStarted;
  console.log(JSON.stringify({
    drones: desiredDroneCount,
    frames,
    avgStepMs: round(elapsedMs / frames, 3),
    forecastSteps: forecast.steps,
    forecastMs: round(forecastMs, 2),
    forecastDriftPx: forecast.drift,
    frameKb: round(bytes / 1_024),
    encodeMs: round(encodeMs, 2),
    active: world.entities.getActiveCount(),
    charged: world.entities.queryList(chargedQuery).count,
    sparks: world.entities.queryList(sparkQuery).count,
    ignited: sim.ignited,
  }));
};

if (profileFrames > 0) {
  runProfile(profileFrames);
  Deno.exit(0);
}

// --- Server ------------------------------------------------------------------------------------

seedWorld();

const sockets = new Set<WebSocket>();

const hello: DemoHello = {
  type: "hello",
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  capacity: CAPACITY,
  minDrones: MIN_DRONES,
  maxDrones: MAX_DRONES,
  droneStep: DRONE_STEP,
  headerBytes: HEADER_BYTES,
  entityBytes: ENTITY_BYTES,
  positionScale: POSITION_SCALE,
  snapshotHz: SNAPSHOT_HZ,
};

const broadcastFrame = (): void => {
  lastFrameBytes = encodeFrame();
  const payload = new Uint8Array(frameBuffer, 0, lastFrameBytes);
  for (const socket of sockets) {
    // Skip slow consumers rather than queueing stale frames.
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < lastFrameBytes) socket.send(payload);
  }
};

const broadcastStatus = (): void => {
  const message = JSON.stringify(status());
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
};

const runSimulationFrame = (): void => {
  const now = performance.now();
  const elapsedMs = Math.max(0, now - previousSimulationFrameMs);
  previousSimulationFrameMs = now;

  if (running) {
    accumulatedSimulationMs = Math.min(accumulatedSimulationMs + elapsedMs, MAX_ACCUMULATED_SIMULATION_MS);
    while (accumulatedSimulationMs >= SIMULATION_STEP_MS) {
      step();
      accumulatedSimulationMs -= SIMULATION_STEP_MS;
    }
    if (forecastEnabled && sockets.size > 0 && now >= nextForecastAt) {
      runForecast();
      // Keep forecasting to at most ~20% of the sim thread.
      nextForecastAt = now + Math.max(FORECAST_INTERVAL_MS, forecast.ms * 5);
    }
  } else {
    accumulatedSimulationMs = 0;
  }

  if (sockets.size > 0) {
    if (now >= nextSnapshotAt) {
      nextSnapshotAt = Math.max(nextSnapshotAt + SNAPSHOT_INTERVAL_MS, now - SNAPSHOT_INTERVAL_MS);
      broadcastFrame();
    }
    if (now >= nextStatusAt) {
      nextStatusAt = now + STATUS_INTERVAL_MS;
      updateRates();
      broadcastStatus();
    }
  }
  setTimeout(runSimulationFrame, Math.max(1, SIMULATION_STEP_MS - (performance.now() - now)));
};

const applyCommand = (command: Partial<DemoCommand> & Record<string, unknown>, from: WebSocket): void => {
  switch (command.action) {
    case "mode":
      if (
        command.mode === "orbit" || command.mode === "storm" || command.mode === "lattice" || command.mode === "flock"
      ) {
        mode = command.mode;
        disturb();
      }
      break;
    case "intensity":
      intensity = clamp(Number(command.value) || 1, 0.2, 2.4);
      disturb();
      break;
    case "contagion":
      contagion = clamp(Number(command.value) || 0, 0, 3);
      disturb();
      break;
    case "drones":
      seedWorld(Number(command.value) || desiredDroneCount);
      break;
    case "forecast":
      forecastEnabled = Boolean(command.enabled);
      forecast.pending = false;
      forecast.drift = null;
      break;
    case "toggle":
      running = !running;
      break;
    case "reset":
      seedWorld();
      break;
    case "burst":
      burst(
        clamp(Number(command.x) || 0, 0, WORLD_WIDTH),
        clamp(Number(command.y) || 0, 0, WORLD_HEIGHT),
        125,
        Number(command.hue) || 184,
      );
      disturb();
      break;
    case "attract":
      attractX = clamp(Number(command.x) || 0, 0, WORLD_WIDTH);
      attractY = clamp(Number(command.y) || 0, 0, WORLD_HEIGHT);
      attractStrength = clamp(Number(command.strength) || 0, -1, 1);
      attractOwner = attractStrength === 0 ? undefined : from;
      disturb();
      break;
  }
};

const socketEndpoint = (request: Request): Response => {
  const { socket, response } = Deno.upgradeWebSocket(request);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    sockets.add(socket);
    socket.send(JSON.stringify(hello));
    socket.send(JSON.stringify(status()));
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      applyCommand(JSON.parse(event.data), socket);
    } catch {
      // Ignore malformed commands.
    }
    broadcastStatus();
  });
  const close = (): void => {
    sockets.delete(socket);
    if (attractOwner === socket || sockets.size === 0) {
      attractOwner = undefined;
      attractStrength = 0;
      disturb();
    }
  };
  socket.addEventListener("close", close);
  socket.addEventListener("error", close);
  return response;
};

const page = (): Response => {
  const settings: Record<string, number> = {
    desiredDroneCount,
    MIN_DRONES,
    MAX_DRONES,
    DRONE_STEP,
  };
  return new Response(htmlTemplate.replaceAll(/\$\{(\w+)\}/g, (_match, key: string) => String(settings[key])), {
    headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
  });
};

Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen: () => {} }, (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") return socketEndpoint(request);
  if (url.pathname === "/client.js") {
    return new Response(clientSource, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  }
  if (url.pathname === "/style.css") {
    return new Response(stylesheet, { headers: { "content-type": "text/css; charset=utf-8" } });
  }
  if (url.pathname === "/" || url.pathname === "/index.html") return page();
  return new Response("Not found", { status: 404 });
});

setTimeout(runSimulationFrame, SIMULATION_STEP_MS);

console.log(`Miski visual demo running at http://127.0.0.1:${PORT}`);
