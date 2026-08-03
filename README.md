# :candy: Miski

**Quechuan** *miski* — *sweet*.

A high-performance Entity-Component-System for TypeScript that tries to make
data-oriented design feel like a treat, not a chore.

Typed-array SoA storage. Generational entity handles. Dense zero-allocation
query loops. Built for game frames and simulations that cannot afford a GC
sugar crash mid-frame.

[![JSR](https://jsr.io/badges/@phughesmcr/miski)](https://jsr.io/@phughesmcr/miski)
[![MIT](https://badgen.net/badge/license/MIT/blue)](./LICENSE)
[![TypeScript](https://badgen.net/badge/icon/typescript?icon=typescript&label)](https://www.typescriptlang.org/)
[![Deno](https://img.shields.io/badge/deno-^2.2.10-lightgrey?logo=deno)](https://deno.com/)
[![Bun](https://img.shields.io/badge/bun-%5E1.3.0-lightgrey?logo=bun)](https://bun.sh/)
[![Node](https://img.shields.io/badge/node-%5E24.0.0-lightgrey?logo=node.js)](https://nodejs.org/)

:book: Hungry for every overload? Full API docs live at
**[jsr.io/@phughesmcr/miski](https://jsr.io/@phughesmcr/miski)**.

---

## :sparkles: Why Miski?

Because ECS should be *miski* — sweet to write, sharp under the hood.

| | |
| --- | --- |
| :zap: **Performant** | `ArrayBuffer`-backed SoA storage, dense `queryList` iteration, and hot paths budgeted for zero steady-state allocation. Your frames stay smooth; the collector stays bored. |
| :dart: **Predictable** | Deterministic results for a given call sequence. Still alpha (`1.0.0-alpha.x`) — breaking changes are called out in docs and tags, no surprise ingredients. |
| :cookie: **Focused** | Runtime deps are first-party only (`bitpool`, `booleanarray`, `partitionedbuffer`). No unrelated third-party surface. Just the pantry we need. |

:fork_and_knife: **On the menu:** good predictable performance · a clean
developer-friendly API · a readable open-source codebase.

:no_entry_sign: **Off the menu:** being the fastest/smallest ECS on the web ·
API interchange with other libraries · polyfills for older runtimes. We cook
for modern JavaScript — no leftovers.

---

## :lollipop: What's inside

- Cache-friendly typed-array SoA component storage
- Generational entity handles with slot-indexed iteration
- More than 32 components per world; optional per-component owner caps
- Define components, queries, and systems once — reuse across worlds
- Query ops: `all` · `any` · `none` · non-filtering `include`
- Dense zero-allocation `queryList` (`entities` + storage `indices`)
- `world.frame(fn)` tick helper with entered / exited / changed tracking
- Typed `createEcsWorld` named-map bootstrap
- Atomic bundles and bulk add/remove for spawn, load, and query-wide transitions
- Component-subset checkpoints and speculative world rollback
- Schema compile + stable FNV hash for tooling and saves
- :page_with_curl: MIT licensed — share freely, keep the wrappers on

---

## :package: Install

Pick your runtime. Same package, same sweetness.

```bash
# Node
npx jsr add @phughesmcr/miski

# Deno
deno add jsr:@phughesmcr/miski

# Bun
bunx jsr add @phughesmcr/miski
```

```ts
import { Component, Query, System, World } from "@phughesmcr/miski";
```

---

## :rocket: Quick start

One complete bite — components, world, spawn, system, frame:

```ts
import { Component, Query, System, World } from "@phughesmcr/miski";

type Vec2 = {
  x: Float32ArrayConstructor;
  y: Float32ArrayConstructor;
};

const Position = new Component<Vec2>({
  name: "position",
  schema: { x: Float32Array, y: Float32Array },
});

const Velocity = new Component<Vec2>({
  name: "velocity",
  schema: { x: Float32Array, y: Float32Array },
});

const world = new World({
  capacity: 1024,
  components: [Position, Velocity],
});

await world.init();

const entity = world.entities.createWithOrThrow([
  [Position, { x: 0, y: 0 }],
  [Velocity, { x: 1, y: 0.5 }],
]);

const movement = new System({
  name: "movement",
  query: new Query({
    all: { position: Position, velocity: Velocity },
  }),
  callback: (components, entities, dt: number) => {
    const pos = components.position.storage.partitions;
    const vel = components.velocity.storage.partitions;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      pos.x[slot]! += vel.x[slot]! * dt;
      pos.y[slot]! += vel.y[slot]! * dt;
    }
  },
});

const runMovement = world.systems.create(movement);

world.frame(() => {
  runMovement(1 / 60);
  // read entered / exited / changed here — refresh runs after the callback
});

console.log(world.components.getEntityData(Position, entity));
// → { x: ~0.0167, y: ~0.0083 }
```

Prefer a typed named map? Same dessert, different plate:

```ts
import { createEcsWorld } from "@phughesmcr/miski";

const game = createEcsWorld({
  capacity: 1024,
  components: {
    Position: { x: Float32Array, y: Float32Array },
    Health: { hp: Uint16Array, maxHp: Uint16Array },
  },
});

await game.init();
const e = game.spawn({
  Position: { x: 0, y: 0 },
  Health: { hp: 10, maxHp: 10 },
});
game.storage.Position.get(e, "x");
```

> :warning: **House rule.** Components are fixed at world creation — the kitchen
> closes after `new World`. Call `world.refresh()` (or wrap a tick in
> `world.frame`) so entered / exited / changed stay fresh.

Want to see it move? :video_game: `deno task demo` · `deno task demo:cli`

---

## :cake: Core concepts

The recipe card. Read top to bottom — each section seasons the next.

### :globe_with_meridians: World

Everything lives in a world: entities, components, systems, archetypes.
Think of it as the bakery where the rest of the kitchen works.

```ts
const world = new World({ capacity: 1024, components: [Position, Velocity] });
await world.init();
world.refresh();           // once per frame
world.frame(() => { /* … */ }); // refresh always runs after the callback
```

Capacity is clamped between **8** and **65536**. Cozy studio or full stadium —
your call.

### :ice_cream: Components

The ingredients. Data (or tag) shapes registered on a world. Create once; reuse
across as many worlds as you like.

```ts
// Data component
const Position = new Component<Vec2>({
  name: "position",
  schema: { x: Float32Array, y: Float32Array },
});

// Tag (no schema) — a label, not a filling
const Active = new Component<null>({ name: "active" });

// Owner cap — only one of these in the jar
const Player = new Component<null>({ name: "player", maxEntities: 1 });

// Narrower public writes than storage
type FacingValue = { dir: 0 | 1 | 2 | 3 };
type FacingStorage = { dir: Uint8ArrayConstructor };
const Facing = new Component<FacingValue, FacingStorage>({
  name: "facing",
  schema: { dir: Uint8Array },
});
```

**Ownership & data** — attach, detach, and bundle without crumbs on the floor:

```ts
world.components.addToEntity(Position, entity, { x: 10, y: 20 });
world.components.removeFromEntity(Position, entity);
world.components.entityHas(Position, entity);

// Atomic multi-component transition (one archetype move)
world.components.addBundle(entity, [
  [Position, { x: 10, y: 20 }],
  [Facing, { dir: 0 }],
]);

// Bulk over a dense query result
const list = world.entities.queryList(new Query({ all: [Position] }));
world.components.addToEntities(Active, list);
```

**Hot-path writes** — when every nanosecond counts, go straight to the SoA
partitions. Index by **storage slot**, not the packed entity handle. Use
`entityIndex(entity)` or `queryList` `indices`. `.partitions` is a friendly
alias of `.storage.partitions`.

```ts
import { entityIndex } from "@phughesmcr/miski";

const instance = world.components.getInstance(Position)!;
instance.storage.partitions.x[entityIndex(entity)] = 1;
instance.markChanged(entity); // ownership-guarded

// Safer (slower) — proxy tracks changed + typeguards
instance.proxy.entity = entity;
instance.proxy.x = 1;

// Public guarded APIs — the polite path
world.components.getEntityData(Position, entity);
world.components.setEntityData(Position, entity, { x: 10, y: 20 });
world.components.markChanged(Position, entity);

// Zero-alloc read into a reused object — no disposable cups
const out = { x: 0, y: 0 };
world.components.readEntityDataInto(Position, entity, out);
```

`getChanged(...)` resets each `world.refresh()` — a fresh tray every frame.
Tags skip changed tracking. Need retained IDs outside the hot path? Reach for
the `*Snapshot` helpers.

### :ghost: Entities

Packed generational handles (slot + generation). Destroying an entity recycles
the slot; old handles fail `isActive` — no zombie leftovers.

```ts
const e = world.entities.create();           // Entity | undefined
const e2 = world.entities.createOrThrow();   // throws when full
const e3 = world.entities.createWith([[Position, { x: 1, y: 2 }]]);

world.entities.destroy(e2);
world.entities.isActive(e);
world.entities.getActiveCount();
world.entities.getAvailableCount();
```

Peek under the wrapper with `entityIndex` · `entityGeneration` · `packEntity`.

### :mag: Queries

Ask the world who's who. Filters taste like boolean algebra:

```ts
const q = new Query({
  all: [Position, Velocity],   // AND — must have every one
  any: [Sprite],               // OR  — at least one
  none: [Hidden],              // NOT — leave these out
  include: [Facing],           // exposed, does not filter
});

const entities = world.entities.query(q);     // convenience iterator
const list = world.entities.queryList(q);     // dense borrowed view

for (let i = 0; i < list.count; i++) {
  const entity = list.entities[i]!; // packed handle — identity APIs
  const slot = list.indices[i]!;    // storage slot — SoA partitions
}

// Borrowed views are valid until the next mutation / refresh.
// Need a take-home box? Opt into allocation:
world.entities.querySnapshot(q);
world.entities.toArray(list);

world.archetypes.queryEntered(q);
world.archetypes.queryExited(q);
```

### :gear: Systems

Where the work happens. Author with keyed component maps for typed instance
records. Callbacks receive a borrowed `BorrowedEntityList` — same shape as
`queryList`, same zero-alloc manners.

```ts
const movement = new System({
  name: "movement",
  query: new Query({
    all: { position: Position, velocity: Velocity },
    include: { facing: Facing },
    none: { hidden: Hidden },
  }),
  callback: (components, entities, dt: number) => {
    const { x, y } = components.position.storage.partitions;
    for (let i = 0; i < entities.count; i++) {
      const slot = entities.indices[i]!;
      x[slot]! += 1 * dt;
      // components.hidden is intentionally unavailable — filtered out of the bowl
    }
  },
});

const run = world.systems.create(movement);
run(1 / 60);
```

Array-based `QuerySpec` / dynamic callbacks still work for stringy, late-bound
code — cast instances before touching concrete partitions.

### :rewind: Checkpoints, rollback, schema

Save a slice. Speculate. Undo. Hash a recipe for later.

```ts
const checkpoint = world.captureCheckpoint([entity], Position);
world.applyCheckpoint(checkpoint);

import {
  captureWorldRollbackPoint,
  restoreWorldRollbackPoint,
} from "@phughesmcr/miski";

const point = captureWorldRollbackPoint(world);
restoreWorldRollbackPoint(world, point);

import { compileComponentSchema, componentSchemaHash } from "@phughesmcr/miski";

compileComponentSchema({ Position: { x: Float32Array, y: Float32Array } });
componentSchemaHash({ Position: { x: Float32Array, y: Float32Array } });
```

`world.queryRevision(query)` bumps when any component in the query is written —
a little ding every time the batter changes.

---

## :stopwatch: Performance

Sweet doesn't mean soft. Miski is tuned for Deno game-loop workloads where
**frame time** and **GC pressure** matter more than winning a synthetic
leaderboard.

Local tasting notes — Deno 2.9.4, aarch64 macOS:

| Path | Result |
| --- | ---: |
| `isActive` / `entityHas` | ~6.5 ns |
| Direct typed-array write + `markChanged` | ~9.6 ns |
| Cached dense `queryList` | ~946 ns |
| Add/remove data component | ~121 ns |
| Archetype move (common gameplay) | ~334 ns |
| Bulk add/remove data — 7,168 entities | ~93 ns/entity |
| Spawn/despawn 128 via `createWith` | ~60 µs |
| Game frame (move + query + refresh) | ~6.8 µs |

Hot entity, ownership, direct-write, cached query, changed/owner iteration,
bulk transition, and game-frame (move + query + refresh) paths are
**effectively allocation-free** in steady state (`deno task bench:gc`) —
about ~3 B/iter of measurement noise on the frame path, not a feast.

Figures are illustrative local snapshots, not CI throughput gates. Absolute
timings vary by machine and workload. Being the fastest ECS on the web is
explicitly **not** a project goal. We'd rather be consistently delicious.

```bash
deno task bench          # throughput
deno task bench:memory   # retained heap / ArrayBuffer
deno task bench:gc       # allocation budgets (also in CI)
deno task bench:all
```

---

## :hammer_and_wrench: Development

Miski uses **Deno 2.x** for local validation and CI. Kitchen rules and floor
plans live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

```bash
deno task ci      # fmt · lint · types · tests · docs · publish dry-run
deno task prep    # format + lint + typecheck
deno task test
deno task demo
deno task demo:cli
```

House style in brief: prefer `.storage.partitions` for SoA access; index typed
arrays by slot (`entityIndex` / `queryList` `indices`), not packed handles;
keep comments ASCII-only in `src/`.

---

## :handshake: Contributing

Pull requests, issues, and feature ideas are all welcome — bring your appetite.
The performance bar is **speed and GC pressure** on real gameplay paths; see
`bench/` for the tasting suite.

Please run `deno task ci` before a PR (`bench:gc` is part of CI). For
performance-sensitive changes, also run `deno task bench` and ideally
`deno task bench:all`.

---

## :heart: Acknowledgements

Standing on the shoulders of sweet giants:
[ape-ecs](https://github.com/fritzy/ape-ecs),
[BECSY](https://github.com/LastOliveGames/becsy),
[bitECS](https://github.com/NateTheGreatt/bitECS),
[ECSY](https://github.com/ecsyjs/ecsy),
[Geotic](https://github.com/ddmills/geotic),
[HECS](https://github.com/gohyperr/hecs),
[Wolf ECS](https://github.com/EnderShadow8/wolf-ecs), and
[Structurae](https://github.com/zandaqo/structurae).

---

## :balance_scale: License

[MIT](./LICENSE) — free as candy on a counter.
© 2024 [The Miski Authors](./AUTHORS.md)
