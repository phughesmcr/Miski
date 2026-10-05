/// <reference lib="dom" />
/// <reference lib="deno.ns" />

/**
 * @module visual-demo
 * @description A live browser visualization powered by a Miski ECS simulation.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

import { asEntity, Component, entityIndex, Query, type Schema, System, World } from "../mod.ts";
import htmlTemplate from "./visual/index.html" with { type: "text" };
import clientSource from "./visual/client.js" with { type: "text" };
import stylesheet from "./visual/style.css" with { type: "text" };
import type { DemoMode, DemoSnapshot } from "./visual/contracts.ts";

type Vec2Schema = {
  x: Float32ArrayConstructor;
  y: Float32ArrayConstructor;
};

type VisualSchema = {
  hue: Float32ArrayConstructor;
  radius: Float32ArrayConstructor;
  alpha: Float32ArrayConstructor;
  energy: Float32ArrayConstructor;
  team: Float32ArrayConstructor;
  kind: Float32ArrayConstructor;
};

type BrainSchema = {
  orbit: Float32ArrayConstructor;
  bias: Float32ArrayConstructor;
  drag: Float32ArrayConstructor;
};

type LifetimeSchema = {
  age: Float32ArrayConstructor;
  ttl: Float32ArrayConstructor;
};

const CAPACITY = 32_000;
const DEFAULT_DRONES = 1_450;
const MIN_DRONES = 128;
const MAX_DRONES = 32_000;
const SNAPSHOT_FPS = 20;
const SNAPSHOT_INTERVAL_MS = 1_000 / SNAPSHOT_FPS;
const SIMULATION_FPS = 60;
const SIMULATION_STEP_SECONDS = 1 / SIMULATION_FPS;
const SIMULATION_STEP_MS = 1_000 / SIMULATION_FPS;
const MAX_ACCUMULATED_SIMULATION_MS = SIMULATION_STEP_MS * 5;
const WORLD_WIDTH = 1_920;
const WORLD_HEIGHT = 1_080;
const DEFAULT_RENDERED_ENTITIES = 4096;
const MAX_RENDERED_ENTITIES = 32_000;
const ENCODER = new TextEncoder();
const GC_SAMPLE_INTERVAL = 120;
const TEAM_COUNT = 4;
const TEAM_HUES = [175, 17, 48, 96] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const numericArg = (flag: string, fallback?: string): number | undefined => {
  const index = Deno.args.findIndex((arg) => arg === flag);
  const raw = index === -1 ? fallback : Deno.args[index + 1];
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

const PORT = numericArg("--port", Deno.args[0]) ?? 8080;
let desiredDroneCount = Math.round(clamp(numericArg("--drones") ?? DEFAULT_DRONES, MIN_DRONES, MAX_DRONES));
let renderedEntityLimit = Math.round(
  clamp(numericArg("--rendered") ?? DEFAULT_RENDERED_ENTITIES, MIN_DRONES, MAX_RENDERED_ENTITIES),
);
const profileFrames = Math.max(0, Math.round(numericArg("--profile-frames") ?? 0));

const schemaVec2: Schema<Vec2Schema> = { x: Float32Array, y: Float32Array };

const position = new Component<Vec2Schema>({ name: "position", schema: schemaVec2 });
const velocity = new Component<Vec2Schema>({ name: "velocity", schema: schemaVec2 });
const visual = new Component<VisualSchema>({
  name: "visual",
  schema: {
    hue: Float32Array,
    radius: Float32Array,
    alpha: Float32Array,
    energy: Float32Array,
    team: Float32Array,
    kind: Float32Array,
  },
});
const brain = new Component<BrainSchema>({
  name: "brain",
  schema: {
    orbit: Float32Array,
    bias: Float32Array,
    drag: Float32Array,
  },
});
const lifetime = new Component<LifetimeSchema>({
  name: "lifetime",
  schema: {
    age: Float32Array,
    ttl: Float32Array,
  },
});
const drone = new Component<null>({ name: "drone" });
const spark = new Component<null>({ name: "spark" });

const world = new World({
  capacity: CAPACITY,
  components: [position, velocity, visual, brain, lifetime, drone, spark],
});

await world.init();

const { partitions: positionStore } = world.components.require(position).storage;
const { partitions: velocityStore } = world.components.require(velocity).storage;
const { partitions: visualStore } = world.components.require(visual).storage;

const droneQuery = new Query({ all: { position, velocity, visual, brain, drone } });
const sparkQuery = new Query({ all: { position, velocity, visual, lifetime, spark } });
const movementQuery = new Query({ all: { position, velocity, visual } });
const renderQuery = new Query({ all: { position, visual } });

let mode: DemoMode = "orbit";
let running = true;
let intensity = 1.0;
let lastTickDuration = 0;
let frame = 0;
let simulationTime = 0;
let accumulatedSimulationMs = 0;
let previousSimulationFrameMs = performance.now();
let entered = 0;
let exited = 0;
let spawned = 0;
let destroyed = 0;
let pulseX = WORLD_WIDTH * 0.5;
let pulseY = WORLD_HEIGHT * 0.5;
let pulseAge = 99;
let heapUsedMb = 0;
let retainedTransitionMetrics = false;
let nextSnapshotAt = 0;

const expiredScratch = new Uint32Array(CAPACITY);
const entityFloatScratch = new Float32Array(MAX_RENDERED_ENTITIES * 11);
const targetXByTeam = new Float32Array(TEAM_COUNT);
const targetYByTeam = new Float32Array(TEAM_COUNT);
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

const random = (min: number, max: number): number => min + Math.random() * (max - min);
const round = (value: number): number => Math.round(value * 10) / 10;

/** Binary entity payloads as base64 — avoids JSON number-array encode/parse cost. */
const encodeBase64 = (bytes: Uint8Array): string => bytes.toBase64();

const countEntities = (entities: IterableIterator<number> | undefined): number => {
  if (!entities) return 0;
  let count = 0;
  for (const _entity of entities) count++;
  return count;
};

const spawnDrone = (x: number, y: number, team: number): boolean => {
  const speed = random(35, 130);
  const angle = random(0, Math.PI * 2);
  const hue = TEAM_HUES[team] ?? TEAM_HUES[0];

  // Atomic spawn: one archetype placement via createWith instead of repeated addToEntity.
  const entity = world.entities.createWith([
    [position, { x, y }],
    [velocity, {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    }],
    [visual, {
      hue: hue + random(-8, 8),
      radius: random(2.1, 4.8),
      alpha: random(0.58, 0.92),
      energy: random(0.35, 1),
      team,
      kind: 0,
    }],
    [brain, {
      orbit: random(-1, 1),
      bias: random(0.15, 1),
      drag: random(0.955, 0.992),
    }],
    [drone],
  ]);
  if (entity === undefined) return false;
  spawned++;
  return true;
};

const spawnSpark = (x: number, y: number, hue: number, strength = 1): boolean => {
  const angle = random(0, Math.PI * 2);
  const speed = random(115, 520) * strength;
  const entity = world.entities.createWith([
    [position, { x, y }],
    [velocity, {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    }],
    [visual, {
      hue: hue + random(-12, 12),
      radius: random(1.4, 5.5) * strength,
      alpha: random(0.52, 0.95),
      energy: random(0.2, 1),
      team: 4,
      kind: 1,
    }],
    [lifetime, { age: 0, ttl: random(0.55, 1.8) }],
    [spark],
  ]);
  if (entity === undefined) return false;
  spawned++;
  return true;
};

const seedWorld = (droneCount = desiredDroneCount): void => {
  // Snapshot before destroy: borrowed getActive() is invalidated by mutations.
  const active = world.entities.getActiveSnapshot();
  for (let i = 0; i < active.length; i++) {
    world.entities.destroy(active[i]!);
  }
  desiredDroneCount = Math.round(clamp(droneCount, MIN_DRONES, MAX_DRONES));
  spawned = 0;
  destroyed = 0;
  simulationTime = 0;
  accumulatedSimulationMs = 0;
  previousSimulationFrameMs = performance.now();
  const rings = 4;
  for (let i = 0; i < desiredDroneCount; i++) {
    const team = i % rings;
    const radius = 120 + (team * 75) + random(-45, 145);
    const angle = (i / desiredDroneCount) * Math.PI * 2 * 9 + team * 0.8;
    const x = WORLD_WIDTH * 0.5 + Math.cos(angle) * radius + random(-90, 90);
    const y = WORLD_HEIGHT * 0.5 + Math.sin(angle) * radius * 0.62 + random(-60, 60);
    spawnDrone(clamp(x, 24, WORLD_WIDTH - 24), clamp(y, 24, WORLD_HEIGHT - 24), team);
  }
  burst(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, 110, 184);
  world.refresh();
};

const burst = (x: number, y: number, count = 90, hue = 185): void => {
  pulseX = x;
  pulseY = y;
  pulseAge = 0;
  for (let i = 0; i < count; i++) {
    spawnSpark(x + random(-12, 12), y + random(-12, 12), hue, random(0.65, 1.45));
  }
};

const steeringSystem = world.systems.create(
  new System({
    name: "steeringSystem",
    query: droneQuery,
    callback: (components, drones, dt: number, time: number) => {
      const cx = WORLD_WIDTH * 0.5;
      const cy = WORLD_HEIGHT * 0.5;
      const currentMode = mode;
      const currentIntensity = intensity;
      const pulsePower = Math.max(0, 1 - pulseAge / 1.8);
      const maxSpeed = currentMode === "storm" ? 520 : 360;

      if (currentMode === "lattice") {
        for (let team = 0; team < TEAM_COUNT; team++) {
          const teamPhase = team * Math.PI * 0.5;
          targetXByTeam[team] = Math.sin(time + teamPhase) * 32;
          targetYByTeam[team] = Math.cos(time * 0.7 + teamPhase) * 26;
        }
      } else if (currentMode === "storm") {
        for (let team = 0; team < TEAM_COUNT; team++) {
          targetXByTeam[team] = time * (0.95 + team * 0.08);
          targetYByTeam[team] = time * (0.82 + team * 0.11);
        }
      } else {
        for (let team = 0; team < TEAM_COUNT; team++) {
          const teamPhase = team * Math.PI * 0.5;
          targetXByTeam[team] = cx + Math.cos(time * 0.22 + teamPhase) * (330 + team * 42);
          targetYByTeam[team] = cy + Math.sin(time * 0.27 + teamPhase) * (185 + team * 28);
        }
      }

      const slots = drones.slots;
      const count = drones.count;
      const positionX = components.position.storage.partitions.x;
      const positionY = components.position.storage.partitions.y;
      const velocityX = components.velocity.storage.partitions.x;
      const velocityY = components.velocity.storage.partitions.y;
      const visualAlpha = components.visual.storage.partitions.alpha;
      const visualEnergy = components.visual.storage.partitions.energy;
      const visualTeam = components.visual.storage.partitions.team;
      const brainOrbit = components.brain.storage.partitions.orbit;
      const brainBias = components.brain.storage.partitions.bias;
      const brainDrag = components.brain.storage.partitions.drag;

      for (let i = 0; i < count; i++) {
        const slot = slots[i]!;
        const x = positionX[slot]!;
        const y = positionY[slot]!;
        const team = visualTeam[slot]! | 0;
        const orbit = brainOrbit[slot]!;
        const bias = brainBias[slot]!;

        let targetX = targetXByTeam[team]!;
        let targetY = targetYByTeam[team]!;

        if (currentMode === "storm") {
          targetX = cx + Math.cos(targetX + orbit * 5) * (120 + team * 95);
          targetY = cy + Math.sin(targetY - orbit * 4) * (90 + team * 80);
        } else if (currentMode === "lattice") {
          const column = ((slot * 37) % 14) - 6.5;
          const row = ((slot * 19) % 9) - 4;
          targetX = cx + column * 118 + targetX;
          targetY = cy + row * 94 + targetY;
        }

        const dx = targetX - x;
        const dy = targetY - y;
        const distanceSquared = dx * dx + dy * dy;
        const distance = distanceSquared > 0 ? Math.sqrt(distanceSquared) : 1;
        const inverseDistance = 1 / distance;
        const tangentX = -dy * inverseDistance;
        const tangentY = dx * inverseDistance;
        const pull = Math.max(0.08, Math.min(1.55, distance / 620)) * currentIntensity;
        const pulseDx = x - pulseX;
        const pulseDy = y - pulseY;
        const pulseDistanceSquared = pulseDx * pulseDx + pulseDy * pulseDy;
        const pulseDistance = pulseDistanceSquared > 0 ? Math.sqrt(pulseDistanceSquared) : 1;
        const inversePulseDistance = 1 / pulseDistance;
        const pulseRadius = 60 + pulseAge * 470;
        const pulseRing = Math.max(0, 1 - Math.abs(pulseDistance - pulseRadius) / 130) * pulsePower;

        let nextVelocityX = (velocityX[slot]! * brainDrag[slot]!) +
          dx * inverseDistance * pull * 22 +
          tangentX * orbit * 34 * bias +
          pulseDx * inversePulseDistance * pulseRing * 285;
        let nextVelocityY = (velocityY[slot]! * brainDrag[slot]!) +
          dy * inverseDistance * pull * 22 +
          tangentY * orbit * 34 * bias +
          pulseDy * inversePulseDistance * pulseRing * 285;

        let speed = Math.sqrt(nextVelocityX * nextVelocityX + nextVelocityY * nextVelocityY);
        if (speed > maxSpeed) {
          const scale = maxSpeed / speed;
          nextVelocityX *= scale;
          nextVelocityY *= scale;
          speed = maxSpeed;
        }
        velocityX[slot] = nextVelocityX;
        velocityY[slot] = nextVelocityY;

        const energy = Math.max(0.12, Math.min(1.3, speed / maxSpeed + pulseRing * 0.65));
        visualEnergy[slot] = energy;
        visualAlpha[slot] = Math.max(0.35, Math.min(1, 0.45 + energy * 0.42));
      }

      pulseAge += dt;
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
        if (progress >= 1) {
          expiredScratch[expiredCount++] = entities[i]!;
        }
      }
      for (let i = 0; i < expiredCount; i++) {
        const entity = expiredScratch[i]!;
        world.entities.destroy(asEntity(entity));
        destroyed++;
      }
    },
  }),
);

seedWorld();

const step = (): void => {
  if (!running) return;
  const started = performance.now();
  const dt = SIMULATION_STEP_SECONDS;
  simulationTime += dt;
  const time = simulationTime;

  steeringSystem(dt, time);
  movementSystem(dt);
  lifetimeSystem(dt);

  if (frame % 90 === 0 && mode === "storm") {
    burst(random(260, WORLD_WIDTH - 260), random(190, WORLD_HEIGHT - 190), 55, random(10, 190));
  }

  const retainTransitions = clients.size > 0;
  world.refresh(false, retainTransitions);
  if (retainTransitions) {
    retainedTransitionMetrics = true;
  } else {
    entered = 0;
    exited = 0;
    retainedTransitionMetrics = false;
  }
  frame++;
  if (frame % GC_SAMPLE_INTERVAL === 0) {
    heapUsedMb = Deno.memoryUsage().heapUsed / 1_048_576;
  }
  lastTickDuration = performance.now() - started;
};

const requestSimulationFrame = (callback: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(performance.now()), SIMULATION_STEP_MS);
};

const runSimulationFrame = (time: number): void => {
  const elapsedMs = Math.max(0, time - previousSimulationFrameMs);
  previousSimulationFrameMs = time;

  if (running) {
    accumulatedSimulationMs = Math.min(
      accumulatedSimulationMs + elapsedMs,
      MAX_ACCUMULATED_SIMULATION_MS,
    );
    while (accumulatedSimulationMs >= SIMULATION_STEP_MS) {
      step();
      accumulatedSimulationMs -= SIMULATION_STEP_MS;
    }
  } else {
    accumulatedSimulationMs = 0;
  }

  // Pace snapshots from the sim clock — setInterval drifts and clumps, which
  // shows up as periodic position "catch-up" on the client.
  if (clients.size > 0 && time >= nextSnapshotAt) {
    nextSnapshotAt = time + SNAPSHOT_INTERVAL_MS;
    broadcastSnapshot();
  }

  requestSimulationFrame(runSimulationFrame);
};

const refreshTransitionMetrics = (): void => {
  if (!retainedTransitionMetrics) {
    entered = 0;
    exited = 0;
    return;
  }
  entered = countEntities(world.archetypes.queryEntered(renderQuery));
  exited = countEntities(world.archetypes.queryExited(renderQuery));
  world.refresh();
  retainedTransitionMetrics = false;
};

const snapshot = (): string => {
  refreshTransitionMetrics();
  const entities = world.entities.queryList(renderQuery);
  const limit = Math.min(entities.count, renderedEntityLimit);
  const floats = entityFloatScratch;
  const slots = entities.slots;
  const entityIds = entities.entities;
  for (let i = 0; i < limit; i++) {
    const slot = slots[i]!;
    const offset = i * 11;
    floats[offset] = positionStore.x[slot]!;
    floats[offset + 1] = positionStore.y[slot]!;
    floats[offset + 2] = velocityStore.x[slot]!;
    floats[offset + 3] = velocityStore.y[slot]!;
    floats[offset + 4] = visualStore.hue[slot]!;
    floats[offset + 5] = visualStore.radius[slot]!;
    floats[offset + 6] = visualStore.alpha[slot]!;
    floats[offset + 7] = visualStore.energy[slot]!;
    floats[offset + 8] = visualStore.team[slot]!;
    floats[offset + 9] = visualStore.kind[slot]!;
    // Lower 16 bits of the packed handle — Float32-safe and dense in [0, capacity).
    floats[offset + 10] = entityIndex(entityIds[i]!);
  }
  const entitiesB64 = encodeBase64(new Uint8Array(floats.buffer, 0, limit * 11 * 4));

  const payload: DemoSnapshot = {
    frame,
    mode,
    running,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    pulse: [round(pulseX), round(pulseY), round(Math.max(0, 1 - pulseAge / 1.8))],
    metrics: {
      active: world.entities.getActiveCount(),
      available: world.entities.getAvailableCount(),
      drones: world.entities.queryList(droneQuery).count,
      sparks: world.entities.queryList(sparkQuery).count,
      entered,
      exited,
      spawned,
      destroyed,
      tickMs: round(lastTickDuration),
      heapMb: round(heapUsedMb),
      rendered: limit,
      renderLimit: renderedEntityLimit,
      droneTarget: desiredDroneCount,
      capacity: CAPACITY,
    },
    stride: 11,
    entitiesB64,
  };
  return JSON.stringify(payload);
};

const runProfile = (frames: number): void => {
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    step();
  }
  const elapsedMs = performance.now() - started;
  const snapshotStarted = performance.now();
  const snapshotBytes = ENCODER.encode(snapshot()).byteLength;
  const snapshotMs = performance.now() - snapshotStarted;
  console.log(
    JSON.stringify({
      drones: desiredDroneCount,
      rendered: renderedEntityLimit,
      frames,
      totalMs: round(elapsedMs),
      avgStepMs: round(elapsedMs / frames),
      lastTickMs: round(lastTickDuration),
      snapshotMs: round(snapshotMs),
      snapshotBytes,
      active: world.entities.getActiveCount(),
    }),
  );
};

if (profileFrames > 0) {
  runProfile(profileFrames);
  Deno.exit(0);
}

const encodeEvent = (event: string, data: string): Uint8Array => ENCODER.encode(`event: ${event}\ndata: ${data}\n\n`);

const broadcastSnapshot = (): void => {
  if (clients.size === 0) return;
  nextSnapshotAt = performance.now() + SNAPSHOT_INTERVAL_MS;
  const chunk = encodeEvent("snapshot", snapshot());
  for (const controller of clients) {
    try {
      controller.enqueue(chunk);
    } catch {
      clients.delete(controller);
    }
  }
};

const eventStream = (info: Deno.ServeHandlerInfo): Response => {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      clients.add(controller);
      controller.enqueue(encodeEvent("snapshot", snapshot()));
    },
    cancel() {
      if (controllerRef) clients.delete(controllerRef);
    },
  });

  // Prefer info.completed over request.signal (legacy abort fires on every success).
  info.completed.catch(() => {
    if (controllerRef) clients.delete(controllerRef);
  });

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
};

const control = async (request: Request): Promise<Response> => {
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload["action"] ?? "");

  if (action === "mode") {
    const nextMode = payload["mode"];
    if (nextMode === "orbit" || nextMode === "storm" || nextMode === "lattice") mode = nextMode;
  } else if (action === "intensity") {
    intensity = clamp(Number(payload["value"]), 0.2, 2.4);
  } else if (action === "toggle") {
    running = !running;
  } else if (action === "reset") {
    seedWorld();
  } else if (action === "drones") {
    seedWorld(Number(payload["value"] ?? desiredDroneCount));
  } else if (action === "rendered") {
    renderedEntityLimit = Math.round(
      clamp(Number(payload["value"] ?? renderedEntityLimit), MIN_DRONES, MAX_RENDERED_ENTITIES),
    );
  } else if (action === "burst") {
    const x = clamp(Number(payload["x"] ?? WORLD_WIDTH * 0.5), 0, WORLD_WIDTH);
    const y = clamp(Number(payload["y"] ?? WORLD_HEIGHT * 0.5), 0, WORLD_HEIGHT);
    burst(x, y, 125, Number(payload["hue"] ?? 184));
  }

  broadcastSnapshot();
  return Response.json({ ok: true, mode, running, intensity, drones: desiredDroneCount });
};

const page = (): Response => {
  const settings: Record<string, number> = {
    desiredDroneCount,
    renderedEntityLimit,
    MIN_DRONES,
    MAX_DRONES,
    MAX_RENDERED_ENTITIES,
  };
  return new Response(htmlTemplate.replaceAll(/\$\{(\w+)\}/g, (_match, key: string) => String(settings[key])), {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
  });
};

Deno.serve({ hostname: "127.0.0.1", port: PORT }, (request, info) => {
  const url = new URL(request.url);
  if (url.pathname === "/client.js") {
    return new Response(clientSource, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  }
  if (url.pathname === "/style.css") {
    return new Response(stylesheet, { headers: { "content-type": "text/css; charset=utf-8" } });
  }
  if (url.pathname === "/events") return eventStream(info);
  if (url.pathname === "/api/control" && request.method === "POST") return control(request);
  if (url.pathname === "/" || url.pathname === "/index.html") return page();
  return new Response("Not found", { status: 404 });
});

requestSimulationFrame(runSimulationFrame);

console.log(`Miski visual demo running at http://127.0.0.1:${PORT}`);
