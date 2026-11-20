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
- Immutable prefabs (entity templates) with static `extends` and bulk instantiate
- Entity relations and hierarchies: pair data, reverse lookups, cascades, traversal
- Component-subset checkpoints and speculative world rollback
- `Schedule`: phases, `before` / `after` ordering, fixed timestep, run conditions
- `CommandBuffer`: deferred spawn / destroy / add / set / remove / relate / unrelate, applied per phase
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

One complete bite — components, world, spawn, system, schedule:

```ts
import { Component, defineComponentSchema, Query, Schedule, System, World } from "@phughesmcr/miski";
import type { ComponentSchema, ScheduleContext } from "@phughesmcr/miski";

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

const entity = world.entities.createOrThrow([
  [Position, { x: 0, y: 0 }],
  [Velocity, { x: 1, y: 0.5 }],
]);

const movement = new System({
  name: "movement",
  query: new Query({
    all: { position: Position, velocity: Velocity },
  }),
  argCount: 1, // receives the schedule's context, allocation-free
  callback: (components, entities, ctx: ScheduleContext) => {
    const pos = components.position.storage.partitions;
    const vel = components.velocity.storage.partitions;

    for (let i = 0; i < entities.count; i++) {
      const slot = entities.slots[i]!;
      pos.x[slot]! += vel.x[slot]! * ctx.dt;
      pos.y[slot]! += vel.y[slot]! * ctx.dt;
    }
  },
});

const schedule = new Schedule(world).add(movement);

schedule.run(1 / 60); // runs every system, then refreshes entered / exited / changed

console.log(world.components.getEntityDataOrThrow(Position, entity));
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
    Hero: { maxOwners: 1 },
  },
});

await game.init();
const e = game.spawnOrThrow({
  Position: { x: 0, y: 0 },
  Health: { hp: 10, maxHp: 10 },
  Player: true,
});
game.storage.Position.get(e, "x");
game.spawn({ Player: true }); // Entity | undefined — undefined when full
```

Every creation method follows one rule: the plain name returns `undefined` when
the world is full, and the `OrThrow` name throws `CapacityError`. Invalid input
(unknown components, bad payloads, owner caps) throws from both.

Every failure Miski throws is a `MiskiError`, so `isMiskiError(error)` tells
library failures apart from errors your own hooks throw. The subclasses name the
cause: `SpecError` (a schema, field, component, prefab, relation or world
definition), `ArgumentError` (a malformed call argument), `ComponentDataError`
(a bad payload), `CapacityError` (the world or a component's `maxOwners` is
full), `EntityNotFoundError`, `NotRegisteredError`, `ComponentOwnershipError`,
`RelationCycleError`, `AlreadyRegisteredError`, `WorldStateError` and
`WorldSaveError`.

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
system whose init completed. Concurrent world teardown rejects; calling
`destroy()` on a destroyed world does nothing. The world ends
`destroyed` if every hook succeeds; otherwise it stays in `error`. After a
failed `init()`, `destroy()` still runs from `error`. `await using world = new World(spec)`
destroys the world when the scope exits, even on a throw (a never-initialized
world is left alone). Lifecycle hooks must not await `world.onReady()`,
`world.destroy()` or their own system's destruction: each waits for the hook.
Such calls reject with `WorldStateError` in the synchronous part of a hook.
After an `await`, make them through the hook's second argument
(`init: async (world, hook) => { await hook.onReady(); }`), which rejects while
the hook is pending; the same call on `world` would wait forever. Destroy ends
the system lifecycle; it does not erase
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
const Player = new Component({ name: "player", maxOwners: 1 });

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

Numeric fields may use any number-valued typed array, including
`Float16Array`: half the memory of `Float32Array` for values that tolerate
about 3 significant digits (range ±65504; guarded writes outside it throw).
`BigInt64Array` and `BigUint64Array` are not supported.

**Non-numeric fields** — mix `field.*` descriptors with typed arrays:

```ts
import { field } from "@phughesmcr/miski";

const Unit = new Component({
  name: "unit",
  schema: {
    hp: Uint16Array,
    alive: field.bool(), // Uint8Array 0 / 1
    state: field.enum(["idle", "run", "dead"]), // Uint8Array label index
    target: field.entity(), // Int32Array handle, -1 = none
    label: field.string(), // JS array
    mesh: field.object<Mesh>({ create: () => new Mesh(), clone: (m) => m.clone() }),
  },
});

world.components.addToEntity(Unit, entity, { state: "run", target: enemy });
world.components.getEntityDataOrThrow(Unit, entity);
// { hp: 0, alive: false, state: "run", target: enemy, label: "", mesh: Mesh }
```

| Field             | Raw `partitions` column      | Guarded value     | New owner starts at     |
| ----------------- | ---------------------------- | ----------------- | ----------------------- |
| `field.bool()`    | `Uint8Array` (0 / 1)         | `boolean`         | `false`                 |
| `field.enum(l)`   | `Uint8Array` / `Uint16Array` | one of the labels | the first label         |
| `field.entity()`  | `Int32Array` (`-1` = none)   | `Entity \| null`  | `null`                  |
| `field.string()`  | `string[]`                   | `string`          | `""`                    |
| `field.object<T>` | `(T \| null)[]`              | `T \| null`       | `create()`, or `null`   |

Guarded writes (`addToEntity`, `setEntityData`, bundles, the proxy,
`instance.set`) check each value's type, and `undefined` is never accepted.
Entity fields accept a live entity or `null`; a destroyed handle throws
`EntityNotFoundError`. Reads (`getEntityData*`, `readEntityDataInto`, the
proxy, `instance.get`) decode raw values; an entity field reads `null` once
its target is destroyed, even if the slot is reused. Raw partitions hold the
encoded values, and string / object columns are capacity-length JS arrays
indexed by slot, as numeric ones are. Removing the component or destroying its
owner resets string and object cells, so the world stops holding the object.
Object fields store references: without a `clone` hook, rollback and
checkpoints restore the same object, but changes made inside it stay. Give
`encode` / `decode` hooks (to and from `string | number | null`) to make an
object field saveable.

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

**Reading and writing values** — three tiers, fastest first. Pick the
slowest one your loop can afford.

| Tier               | Read / write                                                                       | Guards                                        |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| (a) hot path       | `instance.storage.partitions[key][slot]`                                           | none: raw values, no change tracking          |
| (b) guarded cursor | `instance.proxy` (`proxy.entity = e; proxy.x`), `instance.get` / `instance.set`    | ownership, validation, encoding, changed      |
| (c) world calls    | `getEntityData` / `getEntityDataOrThrow`, `readEntityDataInto`, `setEntityData`    | (b) plus liveness and registration            |

House rule for tier (a): **`slots` for storage, `entities` for identity.**
Index partitions by storage slot (`entityIndex(entity)` or `queryList` /
system `slots`), never by the packed handle.

> Brands on `Entity` / `SlotIndex` catch swaps at function APIs (`destroy`,
> `instance.get`, …). Raw `TypedArray` indexing still accepts either number —
> do not write `partitions.x[entity]`.

```ts
import { entityIndex } from "@phughesmcr/miski";

const instance = world.components.getInstanceOrThrow(Position);

// (a) Hot path: raw SoA columns. Mark changed yourself if anyone watches.
instance.storage.partitions.x[entityIndex(entity)] = 1;
instance.markChanged(entity); // ownership-guarded

// (b) Guarded cursor: tracks changed and typeguards each value
instance.proxy.entity = entity;
instance.proxy.x = 1;
instance.set(entity, "y", 2); // one field, leaves the proxy where it was
instance.get(entity, "y"); // 2

// (c) World-level guarded calls: the polite path
world.components.getEntityData(Position, entity); // { x, y } | undefined
world.components.getEntityDataOrThrow(Position, entity); // throws if absent
world.components.setEntityData(Position, entity, { x: 10, y: 20 });
world.components.markChanged(Position, entity);

// Zero-alloc read into a reused object — no disposable cups
const out = { x: 0, y: 0 };
world.components.readEntityDataInto(Position, entity, out); // false if absent
```

Across `world.components`, a plain name returns `undefined` (or `false`) when
the thing is absent, and the `OrThrow` name throws: `getInstance` /
`getInstanceOrThrow`, `getEntityData` / `getEntityDataOrThrow`.

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
const e3 = world.entities.createOrThrow([[Position, { x: 1, y: 2 }]]);
const maybe = world.entities.create();             // Entity | undefined — undefined when full
const maybe2 = world.entities.create([[Position, { x: 1, y: 2 }]]); // likewise

world.entities.destroy(e2);
world.entities.isActive(e);
world.entities.isEmpty(e);                          // active with no components
world.entities.getActiveCount();
world.entities.getAvailableCount();

// Optional active-iteration bounds are raw slots: inclusive start, exclusive end.
world.entities.getActiveSnapshot(entityIndex(e3));
```

Handle `0` is a valid entity (slot 0, generation 0), so test an optional
result with `=== undefined`, never truthiness: `if (maybe !== undefined)`.

Use `entityIndex(handle)` or `asSlotIndex(index)` for ranged iteration bounds.
Packed handles are rejected by the TypeScript API. Spawn payload and capacity
checks finish before entity allocation, so rejected spawns publish no entered
or exited events and do not consume a generation.

Peek under the wrapper with `entityIndex` · `entityGeneration` · `packEntity`.

### :cookie: Prefabs

Bake once, stamp out many. A prefab is an immutable entity template: a set of
components with default values. Like components and queries, prefabs are
definitions — they live outside every world, use no entity slot or capacity,
never show up in queries, and work in any world that registers their
components.

```ts
import { Prefab } from "@phughesmcr/miski";

const goblin = new Prefab({
  name: "goblin",
  components: [[Position, { x: 0, y: 0 }], [Health, { hp: 10, maxHp: 10 }], [Enemy]],
});

// Static inheritance: parent components first, child fields override field by field.
const boss = new Prefab({ name: "boss", extends: goblin, components: [[Health, { hp: 500 }]] });
boss.get(Health); // → { hp: 500, maxHp: 10 }

// Overrides merge per field and may add components the prefab lacks.
const e = world.entities.instantiateOrThrow(goblin, [[Position, { x: 5 }], [Flying]]);
world.entities.instantiate(boss); // Entity | undefined when full

// Bulk, all or nothing: a borrowed list, valid until the next mutation.
const pack = world.entities.instantiateManyOrThrow(goblin, 128);
const { x } = world.components.getInstanceOrThrow(Position).storage.partitions;
for (let i = 0; i < pack.count; i++) x[pack.slots[i]!] = i * 2; // per-instance tweaks
```

Instantiating is the same as `create(bundle)` with the prefab's flattened bundle
followed by any extra override components: same handles, values, changed
marks, archetype, entered order, and allocation-free steady state. Defaults
are validated and canonicalized through each field's typed array when the
prefab is defined, and omitted fields are zero. Every check (payloads, owner
caps, capacity) finishes before allocation, so a rejected call — including a
bulk call that does not fit in full — allocates nothing and consumes no
generation. Instances hold plain copies: nothing reads through to the prefab,
and since prefabs are frozen, nothing can change under them. Instances are
ordinary entities (rollback undoes them like `create(bundle)`), while prefabs
themselves are never part of world state.

`createEcsWorld` has named-map helpers:

```ts
const orc = game.prefab({ Position: { x: 0 }, Enemy: true }, { name: "orc" });
game.instantiateOrThrow(orc, { Position: { y: 3 } }); // Entity
game.instantiate(orc);                                  // Entity | undefined when full
game.instantiateManyOrThrow(orc, 16);                   // borrowed list, all or nothing
```

### :mag: Queries

Ask the world who's who. Filters taste like boolean algebra:

```ts
const q = new Query({
  all: [Position, Velocity],   // AND — must have every one
  any: [Sprite],               // OR  — at least one
  none: [Hidden],              // NOT — leave these out
  include: [Facing],           // exposed, does not filter
});

const entities = world.entities.query(q);     // convenience iterator, own cursor per call
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

world.entities.queryEntered(q);
world.entities.queryExited(q);
```

Create queries once and reuse them: a query lives as long as the world. A world
registers each query the first time it sees it and keeps it current on every
refresh until the world is destroyed; there is no unregister. Making queries
inside a system or a loop repeats that setup, and every distinct filter adds to
the cost of each refresh.

Both `query(q)` and `queryList(q)` read the query's result as it was when they
were called, so destroying or moving the current entity inside the loop skips
nothing. Calling either again for the same query after a mutation refills that
result in place, so don't re-query inside a loop that mutates. Each `query(q)` /
`getActive()` call returns its own pooled iterator, so nested loops over the
same query work; it goes back to the pool when the loop ends or breaks, so
don't call `next()` on it after it reports `done`.

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

Run systems with a [`Schedule`](#calendar-scheduling). `world.systems` owns
their lifecycle: `register(system)` runs the `init` hook (now, or at
`world.init()`), `destroy(system)` runs the `destroy` hook (resolving `false`
if the system is not registered; `destroyOrThrow` rejects instead), and
`get` / `has` look systems up. `Schedule.add` registers a system for you.

`register` and `get` also return the system's instance, a plain function that
runs the system once. Calling it directly is fine for tests, tools or a
hand-written loop, but it bypasses everything a schedule adds: enabled state,
`runIf`, ordering, phases, deferred commands and the end-of-run refresh.

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

const run = world.systems.register(movement);
run(1 / 60); // a direct call: no schedule state applies
```

A system instance forwards whatever arguments its caller passes, which
allocates an arguments array on every call. For a system called with a fixed
number of arguments on a hot path, set `argCount` (0 to 4) in the spec — here
`argCount: 1` for `dt`; for a scheduled system, `1` for the context — and calls
allocate nothing. The callback then always
receives exactly `argCount` arguments: missing ones arrive as `undefined`, and
extras are dropped.

Array-based `QuerySpec` / dynamic callbacks still work for stringy, late-bound
code — cast instances before touching concrete partitions.

### :link: Relations

Relate entities: `ChildOf(parent)`, `Targets(enemy)`. A `Relation` is
registered like a component, and its presence is a tag. A source owns the tag
while it has at least one target, so a plain query on the relation matches
every entity with any target. Retargeting does not move an archetype.

```ts
import { Query, Relation, World } from "@phughesmcr/miski";

const ChildOf = new Relation({
  name: "childOf",
  exclusive: true, // one parent; adding another replaces it
  acyclic: true, // reject pairs that would close a cycle
  onDeleteTarget: "cascade", // destroying a parent destroys its subtree
});
const Targets = new Relation({ name: "targets", schema: { weight: Float32Array } });

const world = new World({ capacity: 1024, components: [Position, ChildOf, Targets] });
await world.init();

world.relations.add(ChildOf, child, parent);
world.relations.add(Targets, archer, orc, { weight: 0.5 });

world.relations.getTarget(ChildOf, child); // parent
world.relations.getSources(ChildOf, parent); // children, borrowed list
world.relations.getTargets(Targets, archer); // borrowed list with data rows
world.relations.queryList(Targets, orc, new Query({ all: [Position] })); // filtered sources
world.entities.queryList(new Query({ all: [Position], none: [ChildOf] })); // roots

const tree = world.relations.traverse(ChildOf); // parents first, cached
for (let i = 0; i < tree.count; i++) visit(tree.entities[i]!, tree.depths[i]!);
```

- **Storage.** Pairs live in an index beside the archetypes, not as one
  component per target, so many targets never fragment archetypes. Every list
  is in insertion order. Pair data is SoA columns indexed by pair row
  (`getInstanceOrThrow(R).partitions.weight[list.rows[i]]`; `getInstance(R)`
  returns `undefined` for an unregistered relation).
- **Exclusive vs multi.** An exclusive relation keeps one target per source and
  stores its data row at the source slot. A multi-target relation draws rows
  from a pool that doubles when full. Adding a pair that already exists keeps
  its position and merges the data you pass.
- **Destroying a target** removes the pairs that point at it by default. With
  `onDeleteTarget: "cascade"` it destroys their sources as well, iteratively
  and safely through cycles. A source that loses its last target loses the tag
  and exits the relation's queries.
- **Removing and testing pairs.** `remove(R, source, target)` and
  `has(R, source, target)` act on one pair; `removeAll(R, source)` and
  `hasAny(R, source)` act on every target of `source`.
- **Changes.** `relations.getChanged(R)` lists sources whose pairs or pair data
  changed in this refresh window. `queryRevision` bumps on any pair change.
- **Handles.** Targets are generational handles. A stale target never matches,
  and a reused slot never inherits pairs.
- **Rollback and checkpoints** restore pairs, list order and data exactly.
  Checkpoints preflight target liveness and cycles before they mutate anything.
- The generic component APIs (`addToEntity`, bundles, `create(bundle)`, ...) refuse
  relation tags; use `world.relations`. `createEcsWorld` takes
  `relations: { ChildOf: { exclusive: true }, ... }` and exposes
  `ecs.relations.ChildOf`.
### :calendar: Scheduling

A `Schedule` is how systems run: in phases, in a deterministic order, with an
optional fixed timestep — and it refreshes the world once at the end, like
`world.frame`.

```ts
import { Schedule } from "@phughesmcr/miski";
import type { ScheduleContext } from "@phughesmcr/miski";

const schedule = new Schedule(world, {
  phases: ["input", { name: "physics", fixed: true }, "update", "render"],
  fixedStep: 1 / 60,  // seconds per fixed step (default 1/60)
  maxFixedSteps: 8,   // per run; whole steps beyond this are dropped (default 8)
});

const physics = new System({
  name: "physics",
  query: new Query({ all: { position: Position, velocity: Velocity } }),
  argCount: 1, // scheduled systems get one argument: the context
  callback: (components, entities, ctx: ScheduleContext) => {
    const pos = components.position.storage.partitions;
    const vel = components.velocity.storage.partitions;
    for (let i = 0; i < entities.count; i++) {
      const slot = entities.slots[i]!;
      pos.x[slot]! += vel.x[slot]! * ctx.dt; // the fixed step in fixed phases
      if (pos.x[slot]! > 1000) ctx.commands.destroy(entities.entities[i]!);
    }
  },
});

schedule
  .add(physics, { phase: "physics" })
  .add(collide, { phase: "physics", after: [physics] })
  .add(draw, { phase: "render", runIf: () => !paused });

function loop(dt: number) {
  schedule.run(dt); // phases, command flushes, then world.refresh()
}
```

- **Order.** Phases run in the order given. Within a phase, systems run in
  the order added, adjusted by `before` / `after` (names or `System`s). Ties
  keep insertion order, so the order is deterministic. A cycle, an unknown
  name, or a constraint against phase order throws `SpecError` (cycles name
  the path, e.g. `a -> b -> a`). `getOrder(phase)` shows the result.
- **Fixed timestep.** Fixed phases must be contiguous. `run(dt)` adds `dt` to
  an accumulator and runs every fixed phase, in order, once per whole step due
  (up to `maxFixedSteps`; whole steps beyond that are dropped). A step counts
  as due within a relative `1e-9` of `fixedStep`, so frame `dt`s that should
  add up to a step (nine `1 / 540` frames for a `1 / 60` step) don't miss it by
  a rounding error. Other phases run once per `run()`.
- **Change windows and fixed phases.** The world refreshes once per `run()`,
  not per fixed step, so what a fixed-phase system sees in the
  entered / exited / changed windows depends on how many steps ran that frame.
  Don't base simulation logic in fixed phases on those windows; read them in
  variable phases instead.
- **Context.** Every system receives the same reused `ScheduleContext`:
  `dt`, `time`, `tick`, `fixedTick`, `alpha` (leftover fraction of a step, for
  interpolation), `phase`, `fixed`, `world`, and `commands`. Declare
  `argCount: 1` (or `0` to ignore it) to keep every call allocation-free. A
  system without `argCount` still gets the context, but its call may allocate;
  `add()` rejects `argCount` 2 to 4.
- **Run conditions.** `runIf` is checked before each call and the system
  runs only when it returns `true`;
  `setEnabled(system, false)` skips a system until re-enabled (it returns
  `false` if the system is not in the schedule). Both apply immediately; `add` / `remove` during a run apply from the next run.
- **Registration.** `add()` registers the system with the world if needed,
  or reuses its existing registration. `remove()` does not destroy it. A
  system whose async `init` is still pending makes `run()` throw
  `WorldStateError`: `await world.onReady()` after adding.
- **Destroyed systems.** Once a system is unregistered from the world
  (`world.systems.destroy()`, or its `init` failed), the schedule drops it as
  if `remove()` had been called: `has()` returns `false` and `run()` skips
  it. Re-registering it on the world does not re-add it; call `add()` again. A
  `before` / `after` constraint naming a dropped system throws `SpecError`,
  as for any name not in the schedule. A system destroyed during a `run()`
  throws `WorldStateError` if it is called later in that run.
- **Errors.** If a system throws, pending commands are discarded, the world
  is refreshed, and the error is rethrown. If a command fails when a phase
  flushes, the rest of that flush still applies, later phases are skipped, the
  world is refreshed, and the first command error is rethrown. Callbacks run
  synchronously.
- **Saves and rollback.** Supported between `run()` calls only. The
  schedule's clock is not part of a world save or rollback scope: keep
  `schedule.getClock()` (plain data) alongside it, and after restoring call
  `schedule.setClock(clock)`. An `accumulator` of a whole `fixedStep` or more
  is reduced to its remainder (the whole steps are dropped). The schedule flushes its commands every phase,
  so its buffer is empty between runs; call `commands.clear()` on any buffer
  you fill outside a run to drop commands from the abandoned timeline.
- **Yielding to the browser.** `run()` is synchronous. To keep input
  responsive, yield between runs, never inside one. Run background work
  (analytics, saving to IndexedDB) on data copied out of the world, not as
  systems with lower priority, which would reorder the simulation:

  ```ts
  const yieldToMain = globalThis.scheduler?.yield?.bind(globalThis.scheduler) ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  async function loop() {
    for (;;) {
      schedule.run(dt);
      await yieldToMain(); // `scheduler.yield()` in Chrome 129+; a timer elsewhere
    }
  }
  ```

  For rendering, drive `run()` from `requestAnimationFrame` instead.

**Command buffers** queue structural changes so you can mutate while
iterating a borrowed view. A `Schedule` flushes its buffer (`ctx.commands`)
at the end of each phase and each fixed step, so later phases see the
changes. You can also use one directly:

```ts
import { CommandBuffer } from "@phughesmcr/miski";

const commands = new CommandBuffer(world);
const bullet = commands.spawn([[Position, { x: 0, y: 0 }], [Velocity, { x: 9, y: 0 }]]);
commands.add(Active, bullet);          // pending handles work until the flush
commands.set(Position, entity, { x: 1 }); // omitted fields keep their values
commands.remove(Velocity, entity);
commands.destroy(other);
const turret = commands.spawn([[Aim, { target: bullet }]]); // field.entity() values may be pending
commands.relate(ChildOf, turret, ship);  // either end may be pending
commands.unrelate(Targets, archer, orc);
commands.flush();                      // applies in queue order
```

Queuing validates components and copies data at once, so data objects can be
reused straight away and bad data throws at the call site. Flushing applies
each command as the direct call would (`create(bundle)`, `destroy`,
`addToEntity`, `setEntityData`, `removeFromEntity`, `relations.add`,
`relations.remove`), except that commands for entities no longer active are
skipped (for `relate` / `unrelate`, if either entity is no longer active). A
pending `field.entity()` value resolves to the spawned entity; like a queued
reference to an entity that died before the flush, it is written as `null` if
its spawn failed. `set` on an active entity that has lost
the component still throws, as the direct call does. A flush never stops
partway: if a command throws, every other command still applies, then the first
error is rethrown, naming the failing command. Commands on the entity of a
failed spawn are skipped. Numeric fields must be finite numbers when queued;
any other schema field is held by reference, validated by the world at flush,
and released afterwards. `pendingCount` counts queued commands. Steady-state queuing and
flushing does not allocate.

### :rewind: Checkpoints, rollback, schema

Save a slice. Speculate. Undo. Hash a recipe for later.

```ts
const checkpoint = world.captureCheckpoint([entity], Position);
world.applyCheckpoint(checkpoint);

// Leaving a `using` block without commit() restores the world, even on a
// throw, so a failed turn can't leave the scope open.
import { WorldRollbackScope } from "@phughesmcr/miski";
{
  using scope = new WorldRollbackScope(world);
  simulateTurn();
  if (turnIsValid()) scope.commit();
}

// Or close it by hand: restore() undoes, commit() keeps.
const scope = new WorldRollbackScope(world);
try {
  simulateTurn();
} finally {
  scope.restore();
}

import { compileComponentSchema, componentSchemaHash, createEcsWorld } from "@phughesmcr/miski";

const schema = compileComponentSchema({ Position: { x: Float32Array, y: Float32Array } });
componentSchemaHash({ Position: { x: Float32Array, y: Float32Array } }); // === schema.schemaHash
// A precompiled schema replaces `components` / `tags`; relations still go beside it.
const typed = createEcsWorld({ capacity: 1024, schema, relations: { ChildOf: { exclusive: true } } });
```

Rollback restores ownership, the component values of owned rows (dense and
capped sparse), and the changed and archetype transition windows captured
before the scope. Its cost scales with the owner count, not world capacity, so
raw writes to slots that do not own the component are not captured.
Restoration is order-neutral: the next allocated slots and the iteration order
of queries and owners match a world that never ran the speculative work.
Revision tokens continue forward after restoration.

Object fields with a `clone` hook are cloned when a rollback scope opens or a
checkpoint is captured, and again on each checkpoint apply, so a reused
checkpoint never shares an object with the world. Without the hook both share
references. Entity fields whose target has died restore as `null`. Field tags
(`bool`, `enum:["a","b"]`, `entity`, `string`, `object`) are part of the schema
hash; numeric-only schemas keep their existing hashes.

Checkpoints are reusable and bound to the capturing world; captured entities
must still be active when applied. `applyCheckpoint` is not atomic: it first
checks, without writing, that every entity is alive, every payload is valid,
no capped component overflows and every relation's pairs can be restored, and
throws with the world unchanged if not. It then writes through the public
component and relation paths, which run object-field `create()` / `clone()`
hooks; a hook that throws there leaves the checkpoint partly applied. Wrap the
apply in a `WorldRollbackScope` when it must be all-or-nothing.

A world permits one open rollback scope, and a world save can't load while one
is open. `commit()`, `restore()` and disposal each close the scope once; using
a closed scope throws `WorldStateError`. System hooks and external side effects
are outside the captured ECS state.

Schema hashes use deterministic code-unit ordering. Regenerate persisted hashes
for schemas mixing uppercase and lowercase names before upgrading.

`world.queryRevision(query)` bumps when any component in the query is written —
a little ding every time the batter changes.

### :floppy_disk: World saves

Bottle the whole jar. Pour it back exactly.

```ts
import { loadWorld, saveWorld, worldSaveFromDocument, worldSaveToDocument } from "@phughesmcr/miski";

const bytes = saveWorld(world); // exact-size Uint8Array
loadWorld(otherWorld, bytes); // same layout: replaces otherWorld's state

let buffer: Uint8Array = new Uint8Array(64 * 1024);
const save = saveWorld(world, buffer); // a view of buffer's first save.byteLength bytes
if (save.buffer !== buffer.buffer) buffer = save; // too small: save is a fresh array, so keep it

const text = JSON.stringify(worldSaveToDocument(bytes)); // plain JSON-safe document
loadWorld(otherWorld, worldSaveFromDocument(JSON.parse(text)));
```

`saveWorld(world, into)` writes into `into` when the save fits and returns a
view of its start; repeated saves of a steady-size world into one buffer
allocate nothing. When `into` is too small, the save goes to a fresh array and
`into` is left alone. `into.byteOffset` must be a multiple of 8.

A save holds entity handles with their generations and allocator state,
component ownership, values and changed lists, the archetype registry order, and
the open entered / exited window. A loaded world behaves exactly like the saved
one: the same handles stay valid, the next created entities get the same
handles, and queries, owners and changes iterate in the same order. Revision
tokens move forward on load, as after rollback. Generations are restored
exactly, so a handle you held from the world's state before the load may name a
different entity after it; re-resolve handles across a load.

A save covers ECS state only. Systems, schedules and their clocks are not part
of it: the target keeps its own systems, and anything outside the world (a
scheduler's tick and accumulator, pending command buffers, your own game state)
must be stored alongside the save. Save and load between frames, not in the
middle of one.

A save loads only into an initialized world, outside a rollback scope, with the
same layout: capacity, and the same components in the same order with the same
names, caps, fields and storage types. `worldSaveLayout(world)` and
`readWorldSaveHeader(bytes)` show both sides. On a mismatch, `loadWorld` throws
`WorldSaveError` naming the first difference, unless you pass a migration:

```ts
loadWorld(world, oldBytes, {
  migrate: (document, target) => ({ ...document, layout: target /* rename, fill, drop... */ }),
});
```

`migrate` runs only on a mismatch and receives the save as a document and the
world's layout. Its result is validated like any other save. Every load is
validated in full before anything changes, so a corrupt, truncated or
incompatible save leaves the world untouched. Validation is structural: the
layout table is hashed, but the body is not checksummed, so a corrupted value
that still fits its field type loads as written. Saves are little-endian. Raw
writes to slots that do not own a component are not saved; NaN payload bits do
not survive the document. The save format is versioned but may still change
before 1.0; a save from an incompatible version is rejected, not misread.

`field.bool()`, `field.enum()` and `field.entity()` columns are saved, and the
layout records their kind and enum labels, so a bool never loads into a `u8`
field and reordered labels are rejected.

`field.string()` fields are saved as UTF-8. A string holding a lone surrogate
cannot be stored as UTF-8, so saving it throws `WorldSaveError`. With a reused
buffer, `saveWorld` writes strings without allocating; loading allocates
only the strings it creates.

`field.object()` fields are saved through their `encode` / `decode` hooks:

```ts
const Sprite = new Component({
  name: "sprite",
  schema: {
    mesh: field.object<Mesh>({
      encode: (mesh) => mesh.id, // string | number | null
      decode: (id) => meshes.get(id as number)!,
    }),
  },
});
```

`encode` runs once per non-null object on every save, and `decode` once per
saved non-null value on every load; neither is called with `null`. A `null`
object saves as `null`, and so does an object whose `encode` returns `null`.
Encoded numbers keep NaN, the infinities and -0. Hooks must not change the
world. Saving a component whose object field has no hooks throws
`WorldSaveError` naming the field: object fields are never skipped. A
throwing `decode` fails the load with `WorldSaveError` (the hook's error is its
`cause`) before anything changes. Allocation inside your hooks is yours; the
save itself adds none.

Relations are saved with their pairs, pair data and changed sources. The layout
records each relation's `exclusive`, `acyclic` and `onDeleteTarget` options and
its pair data fields, so a mismatch is caught like any other layout change. A
loaded world returns the same `getTargets`, `getSources` and `traverse` order
as the saved one, and new pairs get the same rows. With a reused buffer,
`saveWorld` writes relations without allocating. Pair data is saved for
live pairs only. In the document, `document.relations` holds each relation by
name, and it is present only when the layout has relations.

---

## :stopwatch: Performance

Sweet doesn't mean soft. Miski is tuned for Deno game-loop workloads where
**frame time** and **GC pressure** matter more than winning a synthetic
leaderboard.

Local tasting notes — measured on Deno 2.9.7 (the pinned toolchain), aarch64
macOS, `deno task bench:user`; each figure is the mean of three runs, which
agreed within about 3%:

| Path | Result |
| --- | ---: |
| `isActive` | ~5.7 ns |
| `entityHas` | ~9.1 ns |
| Direct typed-array write + `markChanged` | ~11.5 ns |
| Cached dense `queryList` | ~1.0 µs |
| Add/remove data component | ~167 ns |
| Archetype move (common gameplay) | ~408 ns |
| Bulk add/remove data — 7,168 entities | ~86 ns/entity |
| Spawn/despawn 128 via `create(bundle)` | ~77 µs |
| Game frame (move + query + refresh) | ~6.9 µs |

Hot entity, ownership, direct-write, cached query, changed/owner iteration,
bulk transition, and game-frame (move + query + refresh) paths are
**effectively allocation-free** in steady state (`deno task bench:gc`) —
about ~3 B/iter of measurement noise on the frame path, not a feast. The
frame path needs systems declared with `argCount`; without it, each system
call allocates its arguments array (about 32 B plus 8 B per argument).
`Schedule.run` and `CommandBuffer` queue + flush are budgeted
allocation-free too.

Figures are illustrative local snapshots, not CI throughput gates. Absolute
timings vary by machine and workload. Being the fastest ECS on the web is
explicitly **not** a project goal. We'd rather be consistently delicious.

```bash
deno task bench          # throughput
deno task bench:memory   # retained heap / ArrayBuffer budgets (also in CI)
deno task bench:gc       # allocation budgets (also in CI)
deno task bench:query-archetype # query/archetype timing and allocation probes
deno task bench:all
```

---

## :hammer_and_wrench: Development

Miski uses **Deno 2.9.7** for local validation and CI. Kitchen rules and floor
plans live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

```bash
deno task ci      # fmt · lint · types · doc examples · tests · memory + GC budgets · docs · publish dry-run
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
(`entityIndex` / `queryList` `slots`), not packed handles; keep source
ASCII-only (`src/`, `test/` and `bench/` are all linted).

---

## :handshake: Contributing

Pull requests, issues, and feature ideas are all welcome — bring your appetite.
The performance bar is **speed and GC pressure** on real gameplay paths; see
`bench/` for the tasting suite.

Please run `deno task ci` before a PR (`bench:memory` and `bench:gc` are part of CI). For
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
