/// <reference lib="deno.ns" />

import { Component, field, Query, Relation, Schedule, System, World } from "../mod.ts";
import type { ComponentInstance, Entity, ScheduleContext } from "../mod.ts";

export type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };
export type Health = { current: Uint16ArrayConstructor; max: Uint16ArrayConstructor };
export type RenderState = { sprite: Uint16ArrayConstructor; layer: Uint8ArrayConstructor };
export type Lifetime = { ttl: Float32ArrayConstructor };
export type Parent = { parentEntity: Uint32ArrayConstructor };

export type BenchmarkComponents = ReturnType<typeof createBenchmarkComponents>;
export type WideComponents = ReturnType<typeof createWideComponents>;

export type MovementSystem = (dt: number) => void;

export const SMALL_CAPACITY = 1_024;
export const MEDIUM_CAPACITY = 8_192;
export const LARGE_CAPACITY = 32_768;

export function createBenchmarkComponents() {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
  const acceleration = new Component<Vec2>({ name: "acceleration", schema: { x: Float32Array, y: Float32Array } });
  const health = new Component<Health>({
    name: "health",
    schema: { current: Uint16Array, max: Uint16Array },
  });
  const renderState = new Component<RenderState>({
    name: "render_state",
    schema: { sprite: Uint16Array, layer: Uint8Array },
  });
  const lifetime = new Component<Lifetime>({ name: "lifetime", schema: { ttl: Float32Array } });
  const parent = new Component<Parent>({ name: "parent", schema: { parentEntity: Uint32Array } });
  const renderable = new Component<null>({ name: "renderable" });
  const player = new Component<null>({ name: "player", maxOwners: 1 });
  const enemy = new Component<null>({ name: "enemy" });
  const projectile = new Component<null>({ name: "projectile" });
  const sleeping = new Component<null>({ name: "sleeping" });

  return {
    position,
    velocity,
    acceleration,
    health,
    renderState,
    lifetime,
    parent,
    renderable,
    player,
    enemy,
    projectile,
    sleeping,
    all: [
      position,
      velocity,
      acceleration,
      health,
      renderState,
      lifetime,
      parent,
      renderable,
      player,
      enemy,
      projectile,
      sleeping,
    ],
  };
}

export function createWideComponents(count: number = 64) {
  const components = new Array<Component<null>>(count);
  for (let i = 0; i < count; i++) {
    components[i] = new Component<null>({ name: `wide_${i}` });
  }
  return { all: components };
}

export async function createWorld(
  capacity: number = MEDIUM_CAPACITY,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<World> {
  const world = new World({ capacity, components: components.all });
  await world.init();
  return world;
}

export function mustCreateEntity(world: World): Entity {
  const entity = world.entities.create();
  if (entity === undefined) {
    throw new Error("benchmark fixture exhausted entity capacity");
  }
  return entity;
}

export function createMovementQuery(components: BenchmarkComponents): Query {
  return new Query({ all: [components.position, components.velocity], none: [components.sleeping] });
}

export function createRenderableQuery(components: BenchmarkComponents): Query {
  return new Query({ all: [components.position, components.renderState], any: [components.renderable] });
}

export function createProjectileQuery(components: BenchmarkComponents): Query {
  return new Query({ all: [components.position, components.velocity, components.projectile] });
}

export function createWideQuery(components: WideComponents): Query {
  return new Query({
    all: [components.all[0]!, components.all[31]!, components.all[63]!],
    none: [components.all[7]!, components.all[47]!],
  });
}

export function countEntities(iterable: Iterable<Entity> | undefined): number {
  let count = 0;
  if (iterable === undefined) return count;
  for (const _entity of iterable) {
    count++;
  }
  return count;
}

export async function populateMixedWorld(
  capacity: number = MEDIUM_CAPACITY,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<{ world: World; components: BenchmarkComponents; entities: Entity[] }> {
  const world = await createWorld(capacity, components);
  const entities = new Array<Entity>(capacity);

  for (let i = 0; i < capacity; i++) {
    const entity = mustCreateEntity(world);
    entities[i] = entity;
    world.components.addToEntity(components.position, entity, { x: i, y: i * 0.5 });

    if ((i & 1) === 0) {
      world.components.addToEntity(components.velocity, entity, { x: 1, y: -1 });
    }
    if (i % 3 === 0) {
      world.components.addToEntity(components.health, entity, { current: 100, max: 100 });
    }
    if (i % 4 === 0) {
      world.components.addToEntity(components.renderState, entity, { sprite: i & 255, layer: i & 7 });
      world.components.addToEntity(components.renderable, entity);
    }
    if (i % 8 === 0) {
      world.components.addToEntity(components.enemy, entity);
    }
    if (i % 16 === 0) {
      world.components.addToEntity(components.projectile, entity);
      world.components.addToEntity(components.lifetime, entity, { ttl: 3 });
    }
    if (i % 64 === 0) {
      world.components.addToEntity(components.sleeping, entity);
    }
  }

  world.refresh();
  return { world, components, entities };
}

export async function populateMovementWorld(
  capacity: number,
  components: BenchmarkComponents = createBenchmarkComponents(),
  argCount?: 1,
): Promise<{ world: World; components: BenchmarkComponents; entities: Entity[]; movement: MovementSystem }> {
  const world = await createWorld(capacity, components);
  const entities = new Array<Entity>(capacity);

  for (let i = 0; i < capacity; i++) {
    const entity = mustCreateEntity(world);
    entities[i] = entity;
    world.components.addToEntity(components.position, entity, { x: i, y: i });
    world.components.addToEntity(components.velocity, entity, { x: 1, y: -1 });
    if (i % 32 === 0) {
      world.components.addToEntity(components.sleeping, entity);
    }
  }

  const movementSystem = new System({
    name: "movement",
    query: createMovementQuery(components),
    argCount,
    callback: (componentRecord, entities, dt: number): void => {
      const position = componentRecord["position"] as ComponentInstance<Vec2>;
      const velocity = componentRecord["velocity"] as ComponentInstance<Vec2>;
      const positionStorage = position.storage;
      const velocityStorage = velocity.storage;
      if (positionStorage === null || velocityStorage === null) {
        throw new Error("movement fixture expected storage components");
      }
      const px = positionStorage.partitions.x;
      const py = positionStorage.partitions.y;
      const vx = velocityStorage.partitions.x;
      const vy = velocityStorage.partitions.y;
      for (let i = 0; i < entities.count; i++) {
        const slot = entities.slots[i]!;
        px[slot] = (px[slot] ?? 0) + (vx[slot] ?? 0) * dt;
        py[slot] = (py[slot] ?? 0) + (vy[slot] ?? 0) * dt;
      }
    },
  });

  const movement = world.systems.register(movementSystem) as MovementSystem;
  world.refresh();
  return { world, components, entities, movement };
}

export async function populateSparseLifecycleWorld(
  capacity: number,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<{ world: World; components: BenchmarkComponents; recycled: Entity[] }> {
  const world = await createWorld(capacity, components);
  const recycled: Entity[] = [];

  for (let i = 0; i < capacity; i++) {
    const entity = mustCreateEntity(world);
    world.components.addToEntity(components.position, entity, { x: i, y: i });
    if ((i & 1) === 0) {
      world.components.addToEntity(components.velocity, entity, { x: 1, y: 1 });
    }
    if (i % 8 === 0) {
      recycled.push(entity);
    }
  }

  for (const entity of recycled) {
    world.entities.destroy(entity);
  }

  world.refresh();
  return { world, components, recycled };
}

export async function populateWideWorld(
  capacity: number = SMALL_CAPACITY,
  components: WideComponents = createWideComponents(),
): Promise<{ world: World; components: WideComponents; entities: Entity[] }> {
  const world = new World({ capacity, components: components.all });
  await world.init();
  const activeCount = Math.max(0, capacity - 16);
  const entities = new Array<Entity>(activeCount);

  for (let i = 0; i < activeCount; i++) {
    const entity = mustCreateEntity(world);
    entities[i] = entity;
    world.components.addToEntity(components.all[0]!, entity);
    if ((i & 1) === 0) world.components.addToEntity(components.all[31]!, entity);
    if (i % 4 === 0) world.components.addToEntity(components.all[63]!, entity);
    if (i % 16 === 0) world.components.addToEntity(components.all[47]!, entity);
  }

  world.refresh();
  return { world, components, entities };
}

export type Link = { weight: Float32ArrayConstructor };

/**
 * A world with a 4-ary `childOf` hierarchy over `nodes` entities (cascade, acyclic), a multi-target `likes`
 * relation (each node likes the next two nodes) and an exclusive data relation `aims`.
 */
export async function populateRelationWorld(capacity: number, nodes: number = 1_024) {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const childOf = new Relation({ name: "childOf", exclusive: true, acyclic: true, onDeleteTarget: "cascade" });
  const likes = new Relation({ name: "likes" });
  const aims = new Relation({ name: "aims", exclusive: true, schema: { weight: Float32Array } });
  const world = new World({ capacity, components: [position, childOf, likes, aims] });
  await world.init();
  const entities: Entity[] = [];
  for (let i = 0; i < nodes; i++) {
    const entity = mustCreateEntity(world);
    world.components.addToEntity(position, entity, { x: i, y: i });
    entities.push(entity);
    if (i > 0) world.relations.add(childOf, entity, entities[(i - 1) >> 2]!);
  }
  for (let i = 0; i < nodes; i++) {
    world.relations.add(likes, entities[i]!, entities[(i + 1) % nodes]!);
    world.relations.add(likes, entities[i]!, entities[(i + 2) % nodes]!);
    world.relations.add(aims, entities[i]!, entities[(i + 7) % nodes]!, { weight: i });
  }
  world.refresh();
  return { world, position, childOf, likes, aims, entities };
}

/** Sink the scheduled render system writes to, so its work is observable. */
export const scheduledSink = { value: 0 };

/**
 * A movement world driven by a Schedule: movement in "update", a renderable count in "render", one refresh per run.
 * Mirrors the manual argCount game frame (move + query renderables + refresh).
 */
export async function populateScheduledMovementWorld(
  capacity: number,
  components: BenchmarkComponents = createBenchmarkComponents(),
): Promise<{ world: World; components: BenchmarkComponents; schedule: Schedule }> {
  const { world } = await populateMovementWorld(capacity, components, 1);
  for (const entity of world.entities.querySnapshot(createMovementQuery(components))) {
    if ((entity & 1) === 0) world.components.addToEntity(components.renderable, entity);
  }
  world.refresh();
  const schedule = new Schedule(world, { phases: ["update", "render"] });
  schedule.add(
    new System({
      name: "scheduledMovement",
      query: createMovementQuery(components),
      argCount: 1,
      callback: (componentRecord, entities, ctx: ScheduleContext): void => {
        const position = (componentRecord["position"] as ComponentInstance<Vec2>).storage!.partitions;
        const velocity = (componentRecord["velocity"] as ComponentInstance<Vec2>).storage!.partitions;
        const dt = ctx.dt;
        for (let i = 0; i < entities.count; i++) {
          const slot = entities.slots[i]!;
          position.x[slot] = position.x[slot]! + velocity.x[slot]! * dt;
          position.y[slot] = position.y[slot]! + velocity.y[slot]! * dt;
        }
      },
    }),
    { phase: "update" },
  );
  schedule.add(
    new System({
      name: "scheduledRender",
      query: createRenderableQuery(components),
      argCount: 0,
      callback: (_componentRecord, entities): void => {
        scheduledSink.value ^= entities.count;
      },
    }),
    { phase: "render" },
  );
  schedule.run(1 / 60);
  return { world, components, schedule };
}

/**
 * A schedule of `systemCount` no-op systems over four phases (one fixed), with a run condition and a disabled
 * system, on a small world with no structural churn. Isolates scheduler dispatch cost.
 */
export async function createDispatchSchedule(
  systemCount: number = 16,
): Promise<{ world: World; schedule: Schedule }> {
  const marker = new Component<null>({ name: "marker" });
  const world = new World({ capacity: 64, components: [marker] });
  await world.init();
  for (let i = 0; i < 32; i++) world.components.addToEntity(marker, mustCreateEntity(world));
  world.refresh();
  const phases = ["input", "physics", "update", "render"] as const;
  const schedule = new Schedule(world, {
    phases: ["input", { name: "physics", fixed: true }, "update", "render"],
    fixedStep: 1 / 60,
  });
  const query = new Query({ all: [marker] });
  for (let i = 0; i < systemCount; i++) {
    schedule.add(
      new System({
        name: `noop${i}`,
        query,
        argCount: 1,
        callback: (_components, entities, ctx: ScheduleContext): void => {
          scheduledSink.value ^= entities.count + ctx.tick;
        },
      }),
      {
        phase: phases[i % phases.length]!,
        after: i >= phases.length ? [`noop${i - phases.length}`] : [],
        runIf: i === 1 ? (ctx) => ctx.tick > 0 : undefined,
        enabled: i !== 2,
      },
    );
  }
  schedule.run(1 / 60);
  return { world, schedule };
}

/** Labels of mixed lengths and scripts, so UTF-8 encoding takes every branch. */
const SAVE_LABELS = [
  "",
  "orc",
  "goblin archer",
  "caf\u00e9 owner",
  "\u65e5\u672c\u8a9e\u306e\u540d\u524d",
  "\u{1f600}x",
  "a".repeat(48),
];

/** A mesh handle whose save form is a precomputed key, so its codec allocates nothing. */
export class SaveMesh {
  readonly key: string;
  constructor(key: string) {
    this.key = key;
  }
}

/**
 * A world with string fields on half its entities and, with `withObjects`, object fields on an eighth.
 * Without objects every save cost is Miski's own; object encode hooks are user code.
 */
export async function populateNamedWorld(capacity: number, withObjects: boolean = false) {
  const named = new Component({ name: "named", schema: { hp: Uint16Array, label: field.string() } });
  const titled = new Component({ name: "titled", schema: { title: field.string() } });
  const meshed = new Component({
    name: "meshed",
    schema: {
      mesh: field.object<SaveMesh>({ encode: (mesh) => mesh.key, decode: (key) => new SaveMesh(key as string) }),
    },
  });
  const world = new World({ capacity, components: withObjects ? [named, titled, meshed] : [named, titled] });
  await world.init();
  const meshes = SAVE_LABELS.map((label, i) => new SaveMesh(`mesh:${i}:${label}`));
  for (let i = 0; i < capacity / 2; i++) {
    const entity = mustCreateEntity(world);
    world.components.addToEntity(named, entity, { hp: i & 0xffff, label: SAVE_LABELS[i % SAVE_LABELS.length]! });
    if (i % 4 === 0) world.components.addToEntity(titled, entity, { title: `title ${i}` });
    if (withObjects && i % 4 === 1) world.components.addToEntity(meshed, entity, { mesh: meshes[i % meshes.length]! });
  }
  return { world, named, titled, meshed };
}
