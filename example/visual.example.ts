/// <reference lib="dom" />
/// <reference lib="deno.ns" />

/**
 * @module visual-demo
 * @description A live browser visualization powered by a Miski ECS simulation.
 * @copyright 2024 the Miski authors. All rights reserved.
 * @license MIT
 */

import { Component, entityIndex, Query, type Schema, System, World } from "../mod.ts";

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

type DemoMode = "orbit" | "storm" | "lattice";

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
const metric = (value: number): string => String(round(value));

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

      const indices = drones.indices;
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
        const slot = indices[i]!;
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
      const indices = movers.indices;
      const count = movers.count;
      const positionX = components.position.storage.partitions.x;
      const positionY = components.position.storage.partitions.y;
      const velocityX = components.velocity.storage.partitions.x;
      const velocityY = components.velocity.storage.partitions.y;

      for (let i = 0; i < count; i++) {
        const slot = indices[i]!;
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
      const indices = sparks.indices;
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
        const slot = indices[i]!;
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
        world.entities.destroy(entity);
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
  const indices = entities.indices;
  const entityIds = entities.entities;
  for (let i = 0; i < limit; i++) {
    const slot = indices[i]!;
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

  let payload =
    `{"frame":${frame},"mode":"${mode}","running":${running},"width":${WORLD_WIDTH},"height":${WORLD_HEIGHT}`;
  payload += `,"pulse":[${metric(pulseX)},${metric(pulseY)},${metric(Math.max(0, 1 - pulseAge / 1.8))}]`;
  payload +=
    `,"metrics":{"active":${world.entities.getActiveCount()},"available":${world.entities.getAvailableCount()}`;
  payload += `,"drones":${world.entities.queryList(droneQuery).count},"sparks":${
    world.entities.queryList(sparkQuery).count
  }`;
  payload += `,"entered":${entered},"exited":${exited},"spawned":${spawned},"destroyed":${destroyed}`;
  payload += `,"tickMs":${metric(lastTickDuration)},"heapMb":${metric(heapUsedMb)},"rendered":${limit}`;
  payload += `,"renderLimit":${renderedEntityLimit}`;
  payload += `,"droneTarget":${desiredDroneCount},"capacity":${CAPACITY}},"stride":11`;
  payload += `,"entitiesB64":"${entitiesB64}"}`;
  return payload;
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

const page = (): Response =>
  new Response(INDEX_HTML, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
  });

Deno.serve({ hostname: "127.0.0.1", port: PORT }, (request, info) => {
  const url = new URL(request.url);
  if (url.pathname === "/events") return eventStream(info);
  if (url.pathname === "/api/control" && request.method === "POST") return control(request);
  if (url.pathname === "/" || url.pathname === "/index.html") return page();
  return new Response("Not found", { status: 404 });
});

requestSimulationFrame(runSimulationFrame);

console.log(`Miski visual demo running at http://127.0.0.1:${PORT}`);

const INDEX_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miski ECS Visual Demo</title>
  <style>
    @layer reset, base, layout, components, utilities;

    @layer reset {
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      button,
      input,
      output {
        font: inherit;
      }
    }

    @layer base {
      :root {
        color-scheme: dark;
        --ink: oklch(96% 0.018 98);
        --muted: oklch(75% 0.028 112);
        --dim: oklch(58% 0.035 112);
        --panel: rgb(8 10 9 / 0.72);
        --panel-strong: rgb(14 17 15 / 0.84);
        --line: rgb(240 246 224 / 0.16);
        --line-strong: rgb(240 246 224 / 0.28);
        --cyan: oklch(83% 0.15 190);
        --coral: oklch(67% 0.21 31);
        --gold: oklch(84% 0.15 84);
        --shadow: rgb(0 0 0 / 0.42);
      }

      body {
        overflow: hidden;
        background: rgb(3 4 4);
        color: var(--ink);
        font-family: "Iowan Old Style", "Avenir Next", "Gill Sans", sans-serif;
      }

      ::selection {
        background: color-mix(in oklch, var(--gold), transparent 48%);
        color: var(--ink);
      }
    }

    @layer layout {
      .app {
        position: relative;
        min-height: 100dvh;
        isolation: isolate;
      }

      canvas {
        position: fixed;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        cursor: crosshair;
      }

      .chrome {
        position: relative;
        z-index: 3;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 16px;
        min-height: 100dvh;
        padding: 22px;
        pointer-events: none;
      }

      .hud,
      .controlbar {
        pointer-events: auto;
      }

      .hud {
        display: grid;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(10, minmax(0, 1fr));
        gap: 1px;
        width: 100%;
        overflow: clip;
        border: 1px solid var(--line);
        background: var(--line);
        box-shadow: 0 18px 50px var(--shadow);
        backdrop-filter: blur(20px);
      }

      .metric {
        min-width: 0;
        padding: 6px 10px;
        background: var(--panel);
      }

      .metric span {
        display: block;
        color: var(--dim);
        font-size: 0.62rem;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .metric strong {
        display: block;
        margin-top: 3px;
        font-family: "DIN Condensed", "Avenir Next Condensed", sans-serif;
        font-size: 1.25rem;
        font-weight: 700;
        line-height: 0.95;
      }

      .controlbar {
        display: grid;
        grid-template-columns: auto minmax(150px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) auto;
        gap: 12px;
        align-items: center;
        align-self: center;
        width: min(100%, 1280px);
        border: 1px solid var(--line);
        padding: 10px;
        background: var(--panel-strong);
        box-shadow: 0 22px 60px var(--shadow);
        backdrop-filter: blur(24px);
      }

      .segmented,
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .slider {
        display: grid;
        grid-template-columns: 1fr;
        gap: 7px;
        align-items: center;
        padding-inline: 6px;
        color: var(--muted);
        font-size: 0.72rem;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .slider span {
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }

      output {
        color: var(--gold);
        font-family: "DIN Condensed", "Avenir Next Condensed", sans-serif;
        font-size: 1rem;
        line-height: 1;
      }

      input[type="range"] {
        width: 100%;
        accent-color: var(--gold);
        cursor: pointer;
      }
    }

    @layer components {
      button {
        display: inline-grid;
        place-items: center;
        min-height: 42px;
        min-width: 76px;
        border: 1px solid rgb(255 255 255 / 0.15);
        padding: 0 15px;
        background: rgb(255 255 255 / 0.045);
        color: var(--ink);
        text-transform: uppercase;
        letter-spacing: 0;
        font-size: 0.72rem;
        cursor: pointer;
        transition:
          border-color 180ms ease,
          background 180ms ease,
          transform 180ms ease;
      }

      button:hover,
      button:focus-visible {
        border-color: rgb(255 255 255 / 0.45);
        background: rgb(255 255 255 / 0.11);
        transform: translateY(-1px);
        outline: none;
      }

      button[aria-pressed="true"] {
        border-color: color-mix(in oklch, var(--cyan), white 16%);
        background: color-mix(in oklch, var(--cyan), transparent 80%);
        box-shadow: inset 0 -2px 0 var(--cyan);
      }

      .danger {
        border-color: color-mix(in oklch, var(--coral), transparent 48%);
      }

      .accent {
        border-color: color-mix(in oklch, var(--gold), transparent 30%);
      }
    }

    @media (width < 1050px) {
      .metrics {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .controlbar {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .actions {
        justify-content: end;
      }
    }

    @media (width < 720px) {
      .chrome {
        gap: 10px;
        padding: 12px;
      }

      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .metric {
        padding: 5px 10px;
      }

      .metric strong {
        font-size: 1.1rem;
      }

      .controlbar {
        grid-template-columns: 1fr;
      }

      .slider {
        grid-template-columns: 1fr;
        min-width: 100%;
      }

      .segmented button,
      .actions button {
        flex: 1 1 78px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <canvas id="stage" aria-label="Live Miski ECS particle simulation"></canvas>
    <section class="chrome" aria-label="Miski ECS demo controls">
      <header class="hud">
        <div class="metrics" aria-live="polite">
          <div class="metric"><span>Entities</span><strong id="entities">0</strong></div>
          <div class="metric"><span>Tick</span><strong id="tick">0ms</strong></div>
          <div class="metric"><span>Draw</span><strong id="draw">0ms</strong></div>
          <div class="metric"><span>Drones</span><strong id="drones">0</strong></div>
          <div class="metric"><span>Heap</span><strong id="heap">0mb</strong></div>
          <div class="metric"><span>Rendered</span><strong id="rendered">0</strong></div>
          <div class="metric"><span>Exited</span><strong id="exited">0</strong></div>
          <div class="metric"><span>Capacity</span><strong id="capacity">0</strong></div>
          <div class="metric"><span>Spawned</span><strong id="spawned">0</strong></div>
          <div class="metric"><span>Destroyed</span><strong id="destroyed">0</strong></div>
        </div>
      </header>
      <div class="controlbar">
        <div class="segmented" role="group" aria-label="Simulation mode">
          <button data-mode="orbit" aria-pressed="true">Orbit</button>
          <button data-mode="storm" aria-pressed="false">Storm</button>
          <button data-mode="lattice" aria-pressed="false">Lattice</button>
        </div>
        <label class="slider">
          <span>Intensity</span>
          <input id="intensity" type="range" min="0.2" max="2.4" value="1" step="0.05">
        </label>
        <label class="slider">
          <span>Drones <output id="droneTarget">${desiredDroneCount}</output></span>
          <input
            id="droneControl"
            type="range"
            min="${MIN_DRONES}"
            max="${MAX_DRONES}"
            value="${desiredDroneCount}"
            step="64"
          >
        </label>
        <label class="slider">
          <span>Render <output id="renderTarget">${renderedEntityLimit}</output></span>
          <input
            id="renderControl"
            type="range"
            min="${MIN_DRONES}"
            max="${MAX_RENDERED_ENTITIES}"
            value="${renderedEntityLimit}"
            step="64"
          >
        </label>
        <div class="actions">
          <button class="accent" id="burst">Pulse</button>
          <button id="toggle">Pause</button>
          <button class="danger" id="reset">Reset</button>
        </div>
      </div>
    </section>
  </main>
  <script type="module">
    const canvas = document.querySelector("#stage");
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    const DEVICE_DPR = devicePixelRatio || 1;
    const state = {
      worldWidth: 1920,
      worldHeight: 1080,
      stride: 11,
      renderBudget: 900,
      snapshotIntervalMs: 1000 / 20,
      pulse: [960, 540, 0],
      metrics: {},
      mode: "orbit",
      running: true,
      connected: false,
      hueShift: 0,
      drawMs: 0,
      pixelRatio: Math.min(DEVICE_DPR, 2),
    };

    // Ring of two authoritative snapshots + one interpolated frame buffer.
    // Render is delayed by ~1 snapshot so we lerp prev→curr instead of
    // velocity-extrapolating (which snaps when steering diverges).
    const snapSlots = [
      { data: new Float32Array(0), floats: 0, at: 0 },
      { data: new Float32Array(0), floats: 0, at: 0 },
    ];
    let currSnap = 0;
    let interpEntities = new Float32Array(0);
    // prev-snapshot offset by entity id (-1 = absent). Sized for world capacity.
    const prevOffsetByEntity = new Int32Array(32001).fill(-1);

    const COLOR_BUCKETS = 48;
    const bucketCounts = new Uint32Array(COLOR_BUCKETS);
    const bucketStarts = new Uint32Array(COLOR_BUCKETS);
    const bucketCursor = new Uint32Array(COLOR_BUCKETS);
    let bucketOffsets = new Uint32Array(4096);
    const teamRotationCos = new Float32Array(4);
    const teamRotationSin = new Float32Array(4);
    const colorCache = new Map();

    const ensureFloatCapacity = (floats) => {
      if (interpEntities.length >= floats) return;
      let next = Math.max(interpEntities.length, 1024);
      while (next < floats) next *= 2;
      interpEntities = new Float32Array(next);
    };

    const writeSnapshot = (b64, at) => {
      const bytes = typeof Uint8Array.fromBase64 === "function"
        ? Uint8Array.fromBase64(b64)
        : (() => {
          const binary = atob(b64);
          const out = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
          return out;
        })();
      const floatCount = bytes.byteLength / 4;
      const next = currSnap ^ 1;
      const slot = snapSlots[next];
      if (slot.data.length < floatCount) slot.data = new Float32Array(floatCount);
      slot.data.set(new Float32Array(bytes.buffer, bytes.byteOffset, floatCount));
      slot.floats = floatCount;
      slot.at = at;
      currSnap = next;

      const prev = snapSlots[currSnap ^ 1];
      if (prev.at === 0) {
        // First snapshot: mirror so interpolation has a valid prev.
        if (prev.data.length < floatCount) prev.data = new Float32Array(floatCount);
        prev.data.set(slot.data.subarray(0, floatCount));
        prev.floats = floatCount;
        prev.at = at - state.snapshotIntervalMs;
      }

      // Index prev by entity id for order-independent lerp (sparks spawn/despawn).
      prevOffsetByEntity.fill(-1);
      const stride = state.stride;
      for (let o = 0; o < prev.floats; o += stride) {
        const id = prev.data[o + 10] | 0;
        if (id >= 0 && id < prevOffsetByEntity.length) prevOffsetByEntity[id] = o;
      }
    };

    /** Build positions delayed by one snapshot interval (smooth lerp, no catch-up snap). */
    const buildInterpolatedEntities = (now) => {
      const curr = snapSlots[currSnap];
      const prev = snapSlots[currSnap ^ 1];
      const stride = state.stride;
      if (curr.floats === 0) return curr.data.subarray(0, 0);

      const span = Math.max(1, curr.at - prev.at);
      const delay = Math.min(140, Math.max(35, state.snapshotIntervalMs || span));
      const renderTime = now - delay;
      let alpha = (renderTime - prev.at) / span;
      if (!Number.isFinite(alpha)) alpha = 1;

      ensureFloatCapacity(curr.floats);
      const out = interpEntities;
      const a = prev.data;
      const b = curr.data;

      if (alpha <= 0) {
        out.set(b.subarray(0, curr.floats));
        return out.subarray(0, curr.floats);
      }

      const coastSec = alpha >= 1
        ? Math.min((alpha - 1) * span, delay * 0.35) / 1000
        : 0;
      const t = alpha >= 1 ? 1 : alpha;
      const inv = 1 - t;

      for (let o = 0; o < curr.floats; o += stride) {
        const id = b[o + 10] | 0;
        const prevO = id >= 0 && id < prevOffsetByEntity.length ? prevOffsetByEntity[id] : -1;
        if (prevO >= 0) {
          out[o] = a[prevO] * inv + b[o] * t;
          out[o + 1] = a[prevO + 1] * inv + b[o + 1] * t;
          if (coastSec > 0) {
            out[o] += b[o + 2] * coastSec;
            out[o + 1] += b[o + 3] * coastSec;
          }
          out[o + 5] = a[prevO + 5] * inv + b[o + 5] * t;
          out[o + 6] = a[prevO + 6] * inv + b[o + 6] * t;
          out[o + 7] = a[prevO + 7] * inv + b[o + 7] * t;
        } else {
          out[o] = b[o] + b[o + 2] * coastSec;
          out[o + 1] = b[o + 1] + b[o + 3] * coastSec;
          out[o + 5] = b[o + 5];
          out[o + 6] = b[o + 6];
          out[o + 7] = b[o + 7];
        }
        out[o + 2] = b[o + 2];
        out[o + 3] = b[o + 3];
        out[o + 4] = b[o + 4];
        out[o + 8] = b[o + 8];
        out[o + 9] = b[o + 9];
        out[o + 10] = b[o + 10];
      }
      return out.subarray(0, curr.floats);
    };

    const ids = {
      entities: document.querySelector("#entities"),
      tick: document.querySelector("#tick"),
      draw: document.querySelector("#draw"),
      drones: document.querySelector("#drones"),
      heap: document.querySelector("#heap"),
      rendered: document.querySelector("#rendered"),
      exited: document.querySelector("#exited"),
      capacity: document.querySelector("#capacity"),
      spawned: document.querySelector("#spawned"),
      destroyed: document.querySelector("#destroyed"),
      droneTarget: document.querySelector("#droneTarget"),
      droneControl: document.querySelector("#droneControl"),
      renderTarget: document.querySelector("#renderTarget"),
      renderControl: document.querySelector("#renderControl"),
      toggle: document.querySelector("#toggle"),
    };

    const targetPixelRatio = (entityCount) => {
      if (entityCount > 12000) return 1;
      if (entityCount > 5000) return Math.min(DEVICE_DPR, 1.25);
      if (entityCount > 2000) return Math.min(DEVICE_DPR, 1.5);
      return Math.min(DEVICE_DPR, 2);
    };

    const resize = () => {
      const ratio = state.pixelRatio;
      canvas.width = Math.floor(innerWidth * ratio);
      canvas.height = Math.floor(innerHeight * ratio);
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const ensureBucketCapacity = (count) => {
      if (bucketOffsets.length >= count) return;
      let next = bucketOffsets.length;
      while (next < count) next *= 2;
      bucketOffsets = new Uint32Array(next);
    };

    const command = (payload) =>
      fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => undefined);

    let pendingIntensity = 1;
    let intensityFrame = 0;

    const scheduleIntensityCommand = (value) => {
      pendingIntensity = value;
      if (intensityFrame !== 0) return;
      intensityFrame = requestAnimationFrame(() => {
        intensityFrame = 0;
        command({ action: "intensity", value: pendingIntensity });
      });
    };

    const updateHud = () => {
      const metrics = state.metrics;
      ids.entities.textContent = String(metrics.active ?? 0);
      ids.tick.textContent = String(metrics.tickMs ?? 0) + "ms";
      ids.draw.textContent = state.drawMs.toFixed(1) + "ms";
      ids.drones.textContent = String(metrics.drones ?? 0);
      ids.heap.textContent = String(metrics.heapMb ?? 0) + "mb";
      ids.rendered.textContent = String(metrics.rendered ?? 0);
      ids.exited.textContent = String(metrics.exited ?? 0);
      ids.capacity.textContent = String(metrics.capacity ?? 0);
      ids.spawned.textContent = String(metrics.spawned ?? 0);
      ids.destroyed.textContent = String(metrics.destroyed ?? 0);
      ids.droneTarget.textContent = String(metrics.droneTarget ?? ids.droneControl.value);
      if (document.activeElement !== ids.droneControl && metrics.droneTarget) {
        ids.droneControl.value = String(metrics.droneTarget);
      }
      state.renderBudget = metrics.renderLimit ?? state.renderBudget;
      ids.renderTarget.textContent = String(state.renderBudget);
      if (document.activeElement !== ids.renderControl && metrics.renderLimit) {
        ids.renderControl.value = String(metrics.renderLimit);
      }
      ids.toggle.textContent = state.running ? "Pause" : "Resume";
      document.querySelectorAll("[data-mode]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
      });
    };

    const stream = () => {
      const events = new EventSource("/events");
      events.addEventListener("open", () => {
        state.connected = true;
        updateHud();
      });
      events.addEventListener("error", () => {
        state.connected = false;
        updateHud();
      });
      events.addEventListener("snapshot", (event) => {
        const payload = JSON.parse(event.data);
        const now = performance.now();
        const prevAt = snapSlots[currSnap].at;
        if (prevAt > 0) {
          state.snapshotIntervalMs = Math.min(140, Math.max(35, now - prevAt));
        }
        if (payload.entitiesB64) writeSnapshot(payload.entitiesB64, now);
        state.stride = payload.stride;
        state.metrics = payload.metrics;
        state.mode = payload.mode;
        state.running = payload.running;
        state.worldWidth = payload.width;
        state.worldHeight = payload.height;
        state.pulse = payload.pulse;
        const nextRatio = targetPixelRatio(state.metrics.rendered ?? 0);
        if (Math.abs(nextRatio - state.pixelRatio) > 0.01) {
          state.pixelRatio = nextRatio;
          resize();
        }
        updateHud();
      });
    };

    const clearStage = (width, height) => {
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.fillStyle = "rgb(3 4 4)";
      context.fillRect(0, 0, width, height);
    };

    const drawPulse = (scaleX, scaleY) => {
      const [x, y, strength] = state.pulse;
      if (strength <= 0.01) return;
      const screenX = x * scaleX;
      const screenY = y * scaleY;
      const radius = (1 - strength) * Math.min(innerWidth, innerHeight) * 0.44 + 24;
      context.save();
      context.globalCompositeOperation = "lighter";
      context.strokeStyle = "rgb(128 244 224 / " + (0.28 * strength) + ")";
      context.lineWidth = 2 + strength * 8;
      context.beginPath();
      context.arc(screenX, screenY, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = "rgb(255 199 94 / " + (0.18 * strength) + ")";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(screenX, screenY, radius * 0.62, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    };

    const updateTeamRotations = (time) => {
      const baseAngle = time * 0.35;
      for (let team = 0; team < 4; team++) {
        const angle = baseAngle + team * 0.18;
        teamRotationCos[team] = Math.cos(angle);
        teamRotationSin[team] = Math.sin(angle);
      }
    };

    const colorFor = (hue, lightness) => {
      const key = ((hue | 0) * 128) + (lightness | 0);
      let color = colorCache.get(key);
      if (!color) {
        color = "hsl(" + (hue | 0) + " 92% " + lightness + "%)";
        colorCache.set(key, color);
      }
      return color;
    };

    const detailLevel = (count) => {
      if (count > 10000) return 0;
      if (count > 4500) return 1;
      if (count > 1600) return 2;
      return 3;
    };

    const fillBuckets = (entities, maxOffset, stride, hueShift) => {
      const count = maxOffset / stride;
      ensureBucketCapacity(count);
      bucketCounts.fill(0);
      for (let offset = 0; offset < maxOffset; offset += stride) {
        const hue = entities[offset + 4] + hueShift;
        const bucket = ((hue % 360) + 360) % 360 / 360 * COLOR_BUCKETS | 0;
        bucketCounts[bucket]++;
      }
      let start = 0;
      for (let b = 0; b < COLOR_BUCKETS; b++) {
        bucketStarts[b] = start;
        bucketCursor[b] = start;
        start += bucketCounts[b];
      }
      for (let offset = 0, index = 0; offset < maxOffset; offset += stride, index++) {
        const hue = entities[offset + 4] + hueShift;
        const bucket = ((hue % 360) + 360) % 360 / 360 * COLOR_BUCKETS | 0;
        bucketOffsets[bucketCursor[bucket]++] = offset;
      }
    };

    const drawEntityFull = (entities, offset, scaleX, scaleY) => {
      const x = entities[offset];
      const y = entities[offset + 1];
      const velocityX = entities[offset + 2];
      const velocityY = entities[offset + 3];
      const hue = entities[offset + 4];
      const size = entities[offset + 5];
      const alpha = entities[offset + 6];
      const energy = entities[offset + 7];
      const team = entities[offset + 8];
      const kind = entities[offset + 9];
      const screenX = x * scaleX;
      const screenY = y * scaleY;
      const prevX = (x - velocityX * 0.026) * scaleX;
      const prevY = (y - velocityY * 0.026) * scaleY;
      const radius = Math.max(1, size * Math.min(scaleX, scaleY));
      const color = colorFor(hue + state.hueShift, kind === 1 ? 63 : 55);

      context.globalAlpha = alpha * 0.38;
      context.strokeStyle = color;
      context.lineWidth = Math.max(1, radius * (kind === 1 ? 0.75 : 0.45));
      context.beginPath();
      context.moveTo(prevX, prevY);
      context.lineTo(screenX, screenY);
      context.stroke();

      context.globalAlpha = alpha * 0.18;
      context.fillStyle = color;
      context.beginPath();
      context.arc(screenX, screenY, radius * (kind === 1 ? 2.75 : 1.9) * (0.6 + energy), 0, Math.PI * 2);
      context.fill();

      context.globalAlpha = alpha;
      context.beginPath();
      if (kind === 1) {
        context.arc(screenX, screenY, radius * 0.65, 0, Math.PI * 2);
      } else {
        const directionX = screenX - prevX;
        const directionY = screenY - prevY;
        const directionLengthSquared = directionX * directionX + directionY * directionY;
        const inverseDirectionLength = directionLengthSquared > 0.0001 ?
          1 / Math.sqrt(directionLengthSquared) :
          1;
        const baseForwardX = directionLengthSquared > 0.0001 ? directionX * inverseDirectionLength : 1;
        const baseForwardY = directionLengthSquared > 0.0001 ? directionY * inverseDirectionLength : 0;
        const teamIndex = team & 3;
        const rotationCos = teamRotationCos[teamIndex];
        const rotationSin = teamRotationSin[teamIndex];
        const forwardX = baseForwardX * rotationCos - baseForwardY * rotationSin;
        const forwardY = baseForwardX * rotationSin + baseForwardY * rotationCos;
        const sideX = -forwardY;
        const sideY = forwardX;
        context.moveTo(screenX + forwardX * radius * 2.1, screenY + forwardY * radius * 2.1);
        context.lineTo(screenX - forwardX * radius * 1.15 + sideX * radius * 0.92, screenY - forwardY * radius * 1.15 + sideY * radius * 0.92);
        context.lineTo(screenX - forwardX * radius * 0.58, screenY - forwardY * radius * 0.58);
        context.lineTo(screenX - forwardX * radius * 1.15 - sideX * radius * 0.92, screenY - forwardY * radius * 1.15 - sideY * radius * 0.92);
        context.closePath();
      }
      context.fill();
      context.globalAlpha = alpha * 0.76;
      context.fillStyle = "rgb(255 252 226)";
      context.beginPath();
      context.arc(screenX, screenY, Math.max(0.8, radius * 0.38), 0, Math.PI * 2);
      context.fill();
    };

    const drawEntityMedium = (entities, offset, scaleX, scaleY) => {
      const velocityX = entities[offset + 2];
      const velocityY = entities[offset + 3];
      const x = entities[offset] * scaleX;
      const y = entities[offset + 1] * scaleY;
      const radius = Math.max(1.2, entities[offset + 5] * Math.min(scaleX, scaleY));
      const alpha = entities[offset + 6];
      const color = colorFor(entities[offset + 4] + state.hueShift, entities[offset + 9] === 1 ? 63 : 55);

      context.globalAlpha = alpha * 0.34;
      context.strokeStyle = color;
      context.lineWidth = Math.max(1, radius * 0.4);
      context.beginPath();
      context.moveTo(x - velocityX * 0.022 * scaleX, y - velocityY * 0.022 * scaleY);
      context.lineTo(x, y);
      context.stroke();

      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, radius * 0.72, 0, Math.PI * 2);
      context.fill();
    };

    const drawBatchedDots = (entities, maxOffset, stride, scaleX, scaleY, hueShift, useRects) => {
      fillBuckets(entities, maxOffset, stride, hueShift);
      const scale = Math.min(scaleX, scaleY);
      for (let b = 0; b < COLOR_BUCKETS; b++) {
        const start = bucketStarts[b];
        const end = start + bucketCounts[b];
        if (start === end) continue;
        const sampleOffset = bucketOffsets[start];
        const sampleHue = entities[sampleOffset + 4] + hueShift;
        context.fillStyle = colorFor(sampleHue, 56);
        context.beginPath();
        for (let i = start; i < end; i++) {
          const offset = bucketOffsets[i];
          const x = entities[offset] * scaleX;
          const y = entities[offset + 1] * scaleY;
          const radius = Math.max(useRects ? 1.1 : 1.4, entities[offset + 5] * scale * (useRects ? 0.55 : 0.7));
          if (useRects) {
            const size = radius * 2;
            context.rect(x - radius, y - radius, size, size);
          } else {
            context.moveTo(x + radius, y);
            context.arc(x, y, radius, 0, Math.PI * 2);
          }
        }
        context.globalAlpha = 0.82;
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const drawBatchedPoints = (entities, maxOffset, stride, scaleX, scaleY, hueShift) => {
      fillBuckets(entities, maxOffset, stride, hueShift);
      for (let b = 0; b < COLOR_BUCKETS; b++) {
        const start = bucketStarts[b];
        const end = start + bucketCounts[b];
        if (start === end) continue;
        const sampleOffset = bucketOffsets[start];
        context.fillStyle = colorFor(entities[sampleOffset + 4] + hueShift, 58);
        context.beginPath();
        for (let i = start; i < end; i++) {
          const offset = bucketOffsets[i];
          const x = entities[offset] * scaleX;
          const y = entities[offset + 1] * scaleY;
          const size = Math.max(1.5, entities[offset + 5] * Math.min(scaleX, scaleY) * 0.9);
          context.rect(x - size * 0.5, y - size * 0.5, size, size);
        }
        context.globalAlpha = 0.85;
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const render = (timeStamp) => {
      const frameStarted = performance.now();
      const width = innerWidth;
      const height = innerHeight;
      const time = timeStamp / 1000;
      state.hueShift = Math.sin(time * 0.05) * 3;
      const scale = Math.min(width / state.worldWidth, height / state.worldHeight) * 1.08;
      const scaleX = scale;
      const scaleY = scale;
      const offsetX = (width - state.worldWidth * scale) * 0.5;
      const offsetY = (height - state.worldHeight * scale) * 0.5;

      clearStage(width, height);
      context.save();
      context.translate(offsetX, offsetY);
      drawPulse(scaleX, scaleY);
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      const entities = buildInterpolatedEntities(timeStamp);
      const maxOffset = Math.min(entities.length, state.renderBudget * state.stride);
      const count = maxOffset / state.stride;
      const detail = detailLevel(count);

      if (detail === 0) {
        drawBatchedPoints(entities, maxOffset, state.stride, scaleX, scaleY, state.hueShift);
      } else if (detail === 1) {
        drawBatchedDots(entities, maxOffset, state.stride, scaleX, scaleY, state.hueShift, true);
      } else if (detail === 2) {
        for (let offset = 0; offset < maxOffset; offset += state.stride) {
          drawEntityMedium(entities, offset, scaleX, scaleY);
        }
        context.globalAlpha = 1;
      } else {
        updateTeamRotations(time);
        for (let offset = 0; offset < maxOffset; offset += state.stride) {
          drawEntityFull(entities, offset, scaleX, scaleY);
        }
        context.globalAlpha = 1;
      }
      context.restore();

      state.drawMs = performance.now() - frameStarted;
      if ((timeStamp / 250 | 0) !== ((timeStamp - 16) / 250 | 0)) {
        ids.draw.textContent = state.drawMs.toFixed(1) + "ms";
      }

      requestAnimationFrame(render);
    };

    addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", (event) => {
      const scale = Math.min(innerWidth / state.worldWidth, innerHeight / state.worldHeight) * 1.08;
      const x = (event.clientX - (innerWidth - state.worldWidth * scale) * 0.5) / scale;
      const y = (event.clientY - (innerHeight - state.worldHeight * scale) * 0.5) / scale;
      command({ action: "burst", x, y, hue: 184 + Math.random() * 68 });
    });

    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => command({ action: "mode", mode: button.dataset.mode }));
    });
    document.querySelector("#intensity").addEventListener("input", (event) => {
      scheduleIntensityCommand(Number(event.currentTarget.value));
    });
    ids.droneControl.addEventListener("input", (event) => {
      ids.droneTarget.textContent = event.currentTarget.value;
    });
    ids.droneControl.addEventListener("change", (event) => {
      command({ action: "drones", value: Number(event.currentTarget.value) });
    });
    ids.renderControl.addEventListener("input", (event) => {
      ids.renderTarget.textContent = event.currentTarget.value;
    });
    ids.renderControl.addEventListener("change", (event) => {
      command({ action: "rendered", value: Number(event.currentTarget.value) });
    });
    document.querySelector("#burst").addEventListener("click", () => {
      command({ action: "burst", x: 960, y: 540, hue: 184 + Math.random() * 68 });
    });
    document.querySelector("#toggle").addEventListener("click", () => command({ action: "toggle" }));
    document.querySelector("#reset").addEventListener("click", () => command({ action: "reset" }));

    resize();
    stream();
    requestAnimationFrame(render);
  </script>
</body>
</html>`;
