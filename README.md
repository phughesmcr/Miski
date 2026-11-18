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
[![Deno](https://img.shields.io/badge/deno-^2.9.7-lightgrey?logo=deno)](https://deno.com/)
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
| :dart: **Predictable** | Deterministic results for a given call sequence. Beta (`1.0.0-beta.x`) — compatibility changes are recorded in the [changelog](./CHANGELOG.md). |
| :cookie: **Focused** | Runtime deps are first-party only (`booleanarray`, `partitionedbuffer`). No unrelated third-party surface. Just the pantry we need. |

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
- Dense zero-allocation `queryList` (`entities` + storage `slots`)
- `world.frame(fn)` tick helper with entered / exited / changed tracking
- Typed `createEcsWorld` named-map bootstrap
- Atomic bundles and bulk add/remove for spawn, load, and query-wide transitions
- Component-subset checkpoints and speculative world rollback
- Deterministic whole-world saves, binary or lossless JSON
- Schema compile + stable FNV hash for tooling and saves
- :page_with_curl: MIT licensed — share freely, keep the wrappers on

---

## :package: Install

Pick your runtime. Same package, same sweetness.

```bash
# Node
npx jsr add @phughesmcr/miski@1.0.0-beta.2

# Deno
deno add jsr:@phughesmcr/miski@1.0.0-beta.2

# Bun
bunx jsr add @phughesmcr/miski@1.0.0-beta.2
```

```ts
import { Component, Query, System, World } from "@phughesmcr/miski";
```

---

## :rocket: Quick start

One complete bite — components, world, spawn, system, frame:

```ts
import { Component, defineComponentSchema, Query, System, World } from "@phughesmcr/miski";
import type { ComponentSchema } from "@phughesmcr/miski";

// Schema is the source of truth — pick the typed array you mean.
const vec2 = defineComponentSchema({ x: Float32Array, y: Float32Array });
type Vec2 = ComponentSchema<typeof vec2>;

const Position = new Component({ name: "position", schema: vec2 });
const Velocity = new Component({ name: "velocity", schema: vec2 });

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
      const slot = entities.slots[i]!;
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
  tags: {
    Player: true,
    Hero: { maxEntities: 1 },
  },
});

await game.init();
const e = game.spawn({
  Position: { x: 0, y: 0 },
  Health: { hp: 10, maxHp: 10 },
  Player: true,
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

Capacity must be between **8** and **65536**. Cozy studio or full stadium —
your call.

Await `init()` or `onReady()` before running systems. `onReady()` also waits
for pending async init hooks of systems registered later. Lifecycle hooks may
mutate entities and see `state === "initialized"`; that state alone is not a
readiness signal. Callbacks reject during initialization or teardown.

`destroy()` closes system registration immediately, waits for any in-flight
`init()` and pending system init hooks, then runs the destroy hook of every
system whose init completed. Concurrent world teardown rejects. The world ends
`destroyed` if every hook succeeds; otherwise it stays in `error`. After a
failed `init()`, `destroy()` still runs from `error`. Lifecycle hooks must not
await `world.onReady()` or `world.destroy()`; doing so rejects with
`WorldStateError`. Destroy ends the system lifecycle; it does not erase
retained component buffers. Discard component instances and borrowed views with
their world.

### :ice_cream: Components

The ingredients. Data (or tag) shapes registered on a world. Create once; reuse
across as many worlds as you like.

```ts
// Data component — schema picks the typed array; alias without *Constructor noise
const vec2 = defineComponentSchema({ x: Float32Array, y: Float32Array });
type Vec2 = ComponentSchema<typeof vec2>;
const Position = new Component({ name: "position", schema: vec2 });

// Tag (no schema) — a label, not a filling
const Active = new Component({ name: "active" });

// Owner cap — only one of these in the jar
const Player = new Component({ name: "player", maxEntities: 1 });

// Narrower public writes than storage
type FacingValue = { dir: 0 | 1 | 2 | 3 };
const facingSchema = defineComponentSchema({ dir: Uint8Array });
type FacingStorage = ComponentSchema<typeof facingSchema>;
const Facing = new Component<FacingValue, FacingStorage>({
  name: "facing",
  schema: facingSchema,
});
```

Data fields named `entity` or `slot` are reserved for the storage proxy cursor.
New ownership starts every numeric field at zero, including capped components
and omitted fields in partial payloads. Public data writes require finite
numbers; direct partition access remains an unchecked escape hatch.

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
partitions. House rule: **`slots` for storage, `entities` for identity.**
Index partitions by storage slot (`entityIndex(entity)` or `queryList` /
system `slots`), never by the packed handle. `.partitions` is a friendly
alias of `.storage.partitions`.

> Brands on `Entity` / `SlotIndex` catch swaps at function APIs (`destroy`,
> `getAt`, …). Raw `TypedArray` indexing still accepts either number — do not
> write `partitions.x[entity]`.

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
Attaching a data component marks it changed, with or without a payload. Tags
skip changed tracking. Need retained IDs outside the hot path? Reach for
the `*Snapshot` helpers.

### :ghost: Entities

Packed generational handles (slot + generation). Destroying an entity recycles
the slot next-fit: it is reissued only after the allocator has swept past every
other free slot. Old handles fail `isActive` until their slot wraps its 15-bit
generation counter, which takes about 32,768 x (free slots) creations, so keep
some capacity headroom if you hold handles for long. Rollback retains the
allocation counter, so handles issued during speculative work are skipped by
subsequent allocations.

```ts
const e = world.entities.createOrThrow();          // throws CapacityError when full
const e2 = world.entities.createOrThrow();
const e3 = world.entities.createWithOrThrow([[Position, { x: 1, y: 2 }]]);
const maybe = world.entities.create();             // Entity | undefined — undefined when full
const maybe2 = world.entities.createWith([[Position, { x: 1, y: 2 }]]); // likewise

world.entities.destroy(e2);
world.entities.isActive(e);
world.entities.getActiveCount();
world.entities.getAvailableCount();

// Optional active-iteration bounds are raw slots: inclusive start, exclusive end.
world.entities.getActiveSnapshot(entityIndex(e3));
```

Use `entityIndex(handle)` or `asSlotIndex(index)` for ranged iteration bounds.
Packed handles are rejected by the TypeScript API. Spawn payload and capacity
checks finish before entity allocation, so rejected spawns publish no entered
or exited events and do not consume a generation.

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
  const slot = list.slots[i]!;    // storage slot — SoA partitions
}

// Zero-alloc dual walk (slot first):
list.each((slot, entity) => {
  /* partitions[slot] … destroy(entity) … */
});

// Borrowed views are valid until the next mutation / refresh.
// Need a take-home box? Opt into allocation:
world.entities.querySnapshot(q);
world.entities.toArray(list);

world.archetypes.queryEntered(q);
world.archetypes.queryExited(q);
```

Entered / exited are relative to the current refresh window: entered means a
member now but not at window start, exited the reverse. Moves between matching
archetypes, remove-then-re-add, and spawn-then-destroy within one window report
neither. Both list entities in the order they were first touched in the window.
`Query.compose` throws `SpecError` if more than one input has a non-empty `any`
group, or if one component appears under different keys. An `include` entry
whose component another input lists under `all` or `any` with the same key is
dropped.

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
      const slot = entities.slots[i]!;
      x[slot]! += 1 * dt;
      // components.hidden is intentionally unavailable — filtered out of the bowl
    }
  },
});

const run = world.systems.create(movement);
run(1 / 60);
```

A system instance forwards whatever arguments its caller passes, which
allocates an arguments array on every call. For a system called with a fixed
number of arguments on a hot path, set `argCount` (0 to 4) in the spec — here
`argCount: 1` for `dt` — and calls allocate nothing. The callback then always
receives exactly `argCount` arguments: missing ones arrive as `undefined`, and
extras are dropped.

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

Rollback restores ownership, the component values of owned rows (dense and
capped sparse), and the changed and archetype transition windows captured
before the scope. Its cost scales with the owner count, not world capacity, so
raw writes to slots that do not own the component are not captured.
Restoration is order-neutral: the next allocated slots and the iteration order
of queries and owners match a world that never ran the speculative work.
Revision tokens continue forward after restoration.

Checkpoints are reusable and bound to the capturing world; captured entities
must still be active when applied. A world permits one active rollback scope.
Rollback points are owner-bound and consumed by restore or commit; system hooks
and external side effects are outside the captured ECS state.

Schema hashes use deterministic code-unit ordering. Regenerate persisted hashes
for schemas mixing uppercase and lowercase names before upgrading.

`world.queryRevision(query)` bumps when any component in the query is written —
a little ding every time the batter changes.

### :floppy_disk: World saves

Bottle the whole jar. Pour it back exactly.

```ts
import {
  loadWorld,
  measureWorldSave,
  saveWorld,
  saveWorldInto,
  worldSaveFromJSON,
  worldSaveToJSON,
} from "@phughesmcr/miski";

const bytes = saveWorld(world); // exact-size Uint8Array
loadWorld(otherWorld, bytes); // same layout: replaces otherWorld's state

const buffer = new Uint8Array(measureWorldSave(world) * 2);
const length = saveWorldInto(world, buffer); // no allocation with a reused buffer

const text = JSON.stringify(worldSaveToJSON(bytes)); // lossless JSON view
loadWorld(otherWorld, worldSaveFromJSON(JSON.parse(text)));
```

A save holds entity handles with their generations and allocator state,
component ownership, values and changed lists, the archetype registry order, and
the open entered / exited window. A loaded world behaves exactly like the saved
one: the same handles stay valid, the next created entities get the same
handles, and queries, owners and changes iterate in the same order. Revision
tokens move forward on load, as after rollback.

A save covers ECS state only. Systems, schedules and their clocks are not part
of it: the target keeps its own systems, and anything outside the world (a
scheduler's tick and accumulator, pending command buffers, your own game state)
must be stored alongside the save. Save and load between frames, not in the
middle of one.

A save loads only into an initialized world, outside a rollback scope, with the
same layout: capacity, and the same components in the same order with the same
names, caps, fields and storage types. `describeWorldSaveLayout(world)` and
`readWorldSaveHeader(bytes)` show both sides. On a mismatch, `loadWorld` throws
`WorldSaveError` naming the first difference, unless you pass a migration:

```ts
loadWorld(world, oldBytes, {
  migrate: (document, target) => ({ ...document, layout: target /* rename, fill, drop... */ }),
});
```

`migrate` runs only on a mismatch and receives the save as a JSON document and
the world's layout. Its result is validated like any other save. Every load is
validated in full before anything changes, so a corrupt, truncated or
incompatible save leaves the world untouched. Saves are little-endian. Raw
writes to slots that do not own a component are not saved; NaN payload bits do
not survive the JSON view.

---

## :stopwatch: Performance

Sweet doesn't mean soft. Miski is tuned for Deno game-loop workloads where
**frame time** and **GC pressure** matter more than winning a synthetic
leaderboard.

Local tasting notes — measured on Deno 2.9.4, aarch64 macOS (the repository
toolchain is now pinned to Deno 2.9.7; figures have not been re-measured):

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
about ~3 B/iter of measurement noise on the frame path, not a feast. The
frame path needs systems created with `argCount`; without it, each system
call allocates its arguments array (about 32 B plus 8 B per argument).

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

Miski uses **Deno 2.9.7** for local validation and CI. Kitchen rules and floor
plans live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

```bash
deno task ci      # fmt · lint · types · doc examples · tests · GC budgets · docs · publish dry-run
deno task prep    # format + lint + typecheck
deno task test
deno task bundle  # dist/miski.mjs, including dependencies
deno task smoke:consumers # clean Node/Bun packages + real Chromium bundle smoke
deno task demo
deno task demo:cli
```

Consumer smoke checks additionally need Node, npm, Bun, and an external
Playwright installation. Set `MISKI_PLAYWRIGHT_MODULE` to its `index.mjs` path
after installing Chromium with Playwright's CLI. CI installs this test tooling
in a temporary directory; it is not a library dependency. The smoke gate tests
a local tarball of the current source and the browser bundle without publishing.

House style in brief: prefer `.storage.partitions` for SoA access; `slots` for
storage, `entities` for identity; index typed arrays by slot
(`entityIndex` / `queryList` `slots`), not packed handles; keep comments
ASCII-only in `src/`.

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
