# 🍬 Miski ECS

__Miski__: Quechuan adjective meaning "sweet".

__ECS__: Entity-Component-System; a software architecture pattern.

__Miski ECS__: A sweet, high-performance ECS library written in Typescript.

See [jsr.io/@phughesmcr/miski](https://jsr.io/@phughesmcr/miski) for complete documentation.

<p align="left">
  <img src="https://badgen.net/badge/license/MIT/blue" alt="MIT License" />
  <img src="https://badgen.net/badge/icon/typescript?icon=typescript&label" alt="Written in Typescript">
  <img src="https://img.shields.io/badge/deno-^2.2.10-lightgrey?logo=deno" alt="Deno version" />
  <img src="https://img.shields.io/badge/bun-%5E1.3.0-lightgrey?logo=bun" alt="Bun version" />
  <img src="https://img.shields.io/badge/node-%5E24.0.0-lightgrey?logo=node.js" alt="Node version" />
</p>

## Purpose

Miski's purpose is to provide a performant, stable, developer-friendly ECS architecture for modern web projects.

Since ECS libraries are primarily used in games and other performance-critical applications, performant here means:

* Miski aims to minimize garbage collection and memory allocation pressure, reducing the risk of dropped frames.
* Miski takes advantage of web standards like `ArrayBuffer` and `WeakMap` to provide fast, cache-friendly component storage, querying, and iteration.

Stable here means:

* The API will not change meaningfully.
* The results produced by the library are predictable and consistent.
* No 3rd-party dependencies.

Developer-friendly here means:

* The library is well-documented, self-documenting, and has a clean, readable codebase.
* The library is easy to understand, learn, and use.
* The library is easy to extend, customize, and integrate into existing projects.

### Goals

* To provide good and predictable performance
* To provide a developer-friendly API
* To provide a clean, readable, self-documenting, open-source codebase

### Not Goals

Because Miski is designed to be used inside your own projects, we let you configure bundling and performance tuning to suit your needs, therefore the following are not priorities of this project:

* To be the fastest or smallest ECS on the web
* To provide an API that is interchangeable with other ECS libraries
* To provide polyfills, workarounds, or older browser support for modern ECMAScript features

## Features

* Modern modular ESNext data-oriented Typescript codebase
* Fast, cache-friendly ArrayBuffer-based component data storage
* Simple, developer-friendly, human-readable API
* Ability to register more than 32 components in one world
* Ability to limit the number of entities a component can be added to
* Define components, systems and queries once, reuse them across multiple worlds
* `AND`,`OR`,`NOT` operators in Queries
* Dense zero-allocation `queryList` API for index-based hot loops and systems
* Atomic bulk component add/remove APIs for spawn, load, and query-wide transitions
* Opt-in snapshot helpers for tools, tests, and non-frame-critical code
* `world.archetypes.queryEntered` & `world.archetypes.queryExited` methods
* Use `world.components.getChanged(...)` to get data-component entities changed by add-with-data, public setters, or proxies
* MIT license

## Performance Snapshot

Miski is optimized for Deno game-loop workloads where predictable frame time and low GC pressure matter.

Recent local benchmark results on Deno 2.9.0, aarch64 macOS:

| Benchmark | Result |
| --- | ---: |
| `isActive` hot check | 6.8 ns |
| `entityHas` ownership check | 6.1 ns |
| `instance.has` ownership check | 4.1 ns |
| Direct typed-array write + `instance.markChanged` | 9.4 ns |
| `readEntityDataInto` reused object | 21.4 ns |
| Add/remove tag component | 68.0 ns |
| Add/remove data component | 111.6 ns |
| Move entity across common gameplay archetypes | 271.4 ns |
| Bulk add/remove tag component - 7,168 entities | 439.7 us, 61.3 ns/entity |
| Bulk add/remove data component - 7,168 entities | 630.1 us, 87.9 ns/entity |
| Query cache miss after refresh | 1.9 us |
| Cached dense `queryList` iteration | 958.6 ns |
| Cached dense `queryList` iteration with `include` | 2.0 us |
| Dense changed iteration with no changed entities | 10.0 ns |
| Spawn/despawn 128 projectiles - repeated `addToEntity` | 60.7 us |
| Spawn/despawn 128 projectiles - `createWith` bundle | 85.1 us |
| Game frame - move, query renderables, refresh | 7.1 us |

GC allocation pressure is budgeted separately. Hot entity, component check, direct write, cached query list, changed,
and owner iteration paths are effectively allocation-free in steady state. The current `deno task bench:gc` run reports:

| Allocation Scenario | Steady-State Allocation |
| --- | ---: |
| Entity create/destroy recycled hot path | 0.0402 B/iter |
| `isActive` and `entityHas` hot checks | 0.0000 B/iter |
| `instance.has` hot ownership check | 0.0000 B/iter |
| Direct typed-array component writes | 0.0000 B/iter |
| Direct typed-array writes + `instance.markChanged` | 0.0000 B/iter |
| `readEntityDataInto` reused output object | 0.0000 B/iter |
| Cached `queryList` entity iteration | 0.0000 B/iter |
| Cached `queryList` entity iteration with `include` | 0.0000 B/iter |
| Included-component render loop | 0.0000 B/iter |
| Component changed dense iterator | 0.0486 B/iter |
| Component owners iterator | 0.0000 B/iter |
| Spawn/despawn 128 projectiles - repeated `addToEntity` | 0.0000 B/iter |
| Spawn/despawn 128 projectiles - `createWith` bundle | 936.5920 B/iter |
| Add/remove data component runtime transition | 40.0012 B/iter |
| Bulk add/remove tag component - 896 entities | 1.56 KiB/iter |
| Bulk add/remove data component - 896 entities | 1.56 KiB/iter |
| Game frame system + cached render query + refresh | 896.0464 B/iter |

Against a local ECS benchmark shape derived from `noctjs/ecs-benchmark`, Miski ranks in the top three by normalized
geomean when using Deno and Miski's dense/bulk APIs for hot query loops. Cross-library benchmark numbers are sensitive
to runtime, machine, benchmark shape, and API style, so treat this as a comparison aid rather than a universal ranking.

## Installation

### Node

```bash
npx jsr add @phughesmcr/miski
```

```ts
import { World, ... } from "@phughesmcr/miski";
```

### Deno

```bash
deno add jsr:@phughesmcr/miski
```

```ts
import { World, ... } from "@phughesmcr/miski";
```

### Bun

```bash
bunx jsr add @phughesmcr/miski
```

```ts
import { World, ... } from "@phughesmcr/miski";
```

## Development

Miski uses Deno 2.x for local validation and CI.

Run the full contributor check before opening a pull request:

```bash
deno task ci
```

For local formatting plus lint and type checks, run:

```bash
deno task prep
```

Run tests with:

```bash
deno task test
```

Run demos with:

```bash
deno task demo
deno task demo:cli
```

Benchmarks are manual and are not part of PR CI:

```bash
deno task bench
deno task bench:memory
deno task bench:gc
deno task bench:all
```

## Quick Start API Reference

Below are the essentials of the Miski API. For full API documentation see [jsr.io/@phughesmcr/miski](https://jsr.io/@phughesmcr/miski).

Each concept in this reference builds on the previous concept, it should be read in order.

### World

The world object is the primary container for all things Miski.

We can create a new world like so:

```typescript
const world = new World({
  capacity: 1000, // The maximum number of entities to allow in the world (minimum 8)
  components: [
    positionComponent, // We'll create this in the components section below
  ],
});
```

<span style="background-color: #aa0010; color: #ffffff; padding: 4px; border-radius: 4px;">
⚠️ Components cannot be added to a world after its creation.
</span>

&nbsp;

<span style="background-color: #1000aa; color: #ffffff; padding: 4px; border-radius: 4px;">
ℹ️ The world requires frequent maintenance (usually once per frame):
</span>

&nbsp;

```typescript
world.refresh();
```

### Components

A component is a data structure that gives entities their state.

Components can be created once and used across multiple worlds.

For example, to create a 2d position component:

```typescript
// Optional schema:
type Vec2 = { x: Float32ArrayConstructor, y: Float32ArrayConstructor }; // defines what input we want (number only)

const positionComponent = new Component<Vec2>({
  // ⚠️ There are some names you cannot use for components or their schema properties. 
  // You can use `isValidName()` to check if a name is valid.
  name: "position",

  // The schema relates to the input type above, in this case Vec2.
  // It defines how we want to store the expected datatype (number).
  // Since we know a Vec2 requires X and Y to be Float32Array, we can define the schema like so:
  schema: {
    x: Float32Array,
    y: Float32Array,
  },
});
```

When the public write type is narrower than the storage schema, provide both shapes. `TValue` is what callers may write
through `addToEntity`, `setEntityData`, bundle data, and the proxy; `TStorage` is the runtime schema that determines the
typed-array partitions:

```typescript
type FacingValue = { dir: 0 | 1 | 2 | 3 };
type FacingStorage = { dir: Uint8ArrayConstructor };

const facingComponent = new Component<FacingValue, FacingStorage>({
  name: "facing",
  schema: { dir: Uint8Array },
});

world.components.addToEntity(facingComponent, entity, { dir: 2 }); // ok
// world.components.addToEntity(facingComponent, entity, { dir: 7 }); // type error
```

#### Tags

We can create a tag component by omitting the schema object and (optionally) providing a null type:

```typescript
const activeComponent = new Component<null>({
  name: "active"
});
```

#### MaxEntities

By default a component can be added to as many entities as the world's capacity, we can change this behaviour like so:

```typescript
const player = new Component<null>({
  name: "player",
  maxEntities: 1,
});
```

#### Adding and Removing Components

We can add and remove components from entities like so:

```typescript
// Add the component to an entity:
world.components.addToEntity(positionComponent, entity);

// Add with initial data:
world.components.addToEntity(positionComponent, entity, { x: 10, y: 20 });
```

```typescript
// Remove the component from an entity:
world.components.removeFromEntity(positionComponent, entity);
```

Bundles add or upsert multiple components atomically and move the entity once to its final archetype:

```typescript
world.components.addBundle(entity, [
  [positionComponent, { x: 10, y: 20 }],
  [facingComponent, { dir: 0 }],
  [renderableComponent],
]);

const spawned = world.entities.createWith([
  [positionComponent, { x: 1, y: 2 }],
  [renderableComponent],
]);

const spawnedOrThrow = world.entities.createWithOrThrow([
  [positionComponent, { x: 1, y: 2 }],
  [renderableComponent],
]);
```

Bundle preflight rejects duplicate components, unregistered components, inactive target entities, tag data, and component
owner-capacity overflow before mutating ownership, data, changed state, archetypes, or query caches.

For spawn, load, and other bulk transitions across a dense query result, resolve the query once and use the batch APIs:

```typescript
const query = new Query({ all: [positionComponent] });
const entities = world.entities.queryList(query);

// Add a tag or data component to every entity in the dense list:
const added = world.components.addToEntities(renderableComponent, entities);

// Remove it again:
const removed = world.components.removeFromEntities(renderableComponent, entities);
```

The return value is the number of entities whose ownership changed.

Batch add/remove preflights the full dense list before mutating anything. Inactive entities, duplicate entity IDs, and
capacity failures throw before ownership, component data, archetypes, changed state, or query caches are changed.
Removal remains idempotent for active entities that do not own the component. These APIs are optimized for bulk
archetype movement, but they are still transitions; avoid using them as per-frame whole-world toggles when a tag,
query filter, or data field can represent the same state.

#### Test for Component presence

We can also test if entities have components:

```typescript
// Check if an entity has a component
const hasPosition: boolean = world.components.entityHas(positionComponent, entity);
```

Inside hot loops that already hold a component instance, use the direct instance check:

```typescript
const hasFacing = facingInstance.has(entity);
```

#### Modifying an Entity's Component properties

To access the component's data from a specific world, we have to get the ComponentInstance, like so:

```typescript
// returns ComponentInstance<T> or undefined
const positionInstance = world.components.getInstance(positionComponent);

// For multiple components:
const instances = world.components.getInstances([positionComponent, ...]);
```

<span style="background-color: #1000aa; color: #ffffff; padding: 4px; border-radius: 4px;">
ℹ️ The component instance is accessible quickly using Systems (see below).
</span>

&nbsp;

Once we have the component instance we can modify entity properties.

There are two ways to do this:

The first is quick but unsafe (no automatic change tracking and no ownership checks):

```typescript
positionInstance.storage.partitions.x[entity] = 1;
positionInstance.markChanged(entity); // ownership-guarded manual changed mark
```

The second is slower but safer (with change tracking and type guards):

```typescript
positionInstance.proxy.entity = entity;
positionInstance.proxy.x = 1;
```

The second way, using `.proxy`, has the advantage of also adding the entity to changed tracking as well as performing
some basic typeguarding.

For convenience, the public data APIs perform ownership and data-storage checks:

```typescript
const data = world.components.getEntityData(positionComponent, entity);
world.components.setEntityData(positionComponent, entity, { x: 10, y: 20 });
world.components.markChanged(positionComponent, entity);
```

These public methods throw Miski errors for inactive entities, unregistered components, tag components, and active
entities that do not own the requested data component. Direct typed-array storage remains the explicit opt-out path for
performance-sensitive code that wants raw access without guards.

For example:

```typescript
// Direct storage access - no change tracking
positionInstance.storage.partitions.x[101] = 1;

// Proxy access - with change tracking
positionInstance.proxy.entity = 444;
positionInstance.proxy.x = 1;

// Only entity 444 appears in changed tracking
const changed = world.components.getChanged(positionComponent);
for (const entity of changed) {
  console.log(entity); // 444 only, not 101
}
```

<span style="background-color: #1000aa; color: #ffffff; padding: 4px; border-radius: 4px;">
ℹ️  The `changed` tracking is reset with every `world.refresh()`.
</span>

&nbsp;

You can also access the changed entities of a component like so:

```typescript
const changed = world.components.getChanged(positionComponent);
```

`getChanged(...)` is backed by a borrowed dense iterator for data components and returns each entity at most once per
refresh window, even when multiple fields change. Tag components currently return an empty changed iterator. Use
`getChangedSnapshot(...)` when retained stable IDs are needed.

For non-throwing reads, use `readEntityData(...)`. To avoid allocating a fresh data object in hot paths, reuse an output
object with `readEntityDataInto(...)`:

```typescript
const out = { x: 0, y: 0 };
if (world.components.readEntityDataInto(positionComponent, entity, out)) {
  // out.x and out.y were overwritten.
}
```

`readEntityDataInto(...)` returns `false` for inactive entities, non-owners, and tag components without changing `out`.
Only unregistered components throw.

### Entities

Entities are just integers. They are essentially indexes or pointers into various arrays in the world.

```typescript
// Create (will return undefined if no entities are available)
const entity = world.entities.create();
// Destroy
world.entities.destroy(entity);
// Test if entity is active in the world
world.entities.isActive(entity);
// Test if an entity is valid in the world
world.entities.isEntity(4235); // will return false if the world capacity is 1000 as above
// Get the number of active entities in a world
const active = world.entities.getActiveCount();
// Get the number of remaining available entities in a world
const available = world.entities.getAvailableCount();
```

### Queries

Queries help us to find relationships between entities and components.

```typescript
const positionQuery = new Query({
  all: [positionComponent],
  any: [...],
  none: [...],
  include: [...],
});
```

`all` is an AND filter. `any` is an OR filter: when supplied, an entity must have at least one of those components.
`none` is a NOT filter. `include` is non-filtering: included component instances are exposed to callbacks and component
queries but do not change entity membership.

We can then access the entities and components which match our query:

```typescript
const components = world.components.query(positionQuery);
const entities = world.entities.query(positionQuery);
```

For performance-sensitive loops, use `queryList` to get a dense reusable view of matching entity IDs:

```typescript
const result = world.entities.queryList(positionQuery);
for (let i = 0; i < result.count; i++) {
  const entity = result.indices[i];
  positionX[entity] += 1;
}
```

`queryList` returns a borrowed, pooled view, not a stable snapshot. The result is valid only until the next
world mutation, query invalidation, or `world.refresh()`. Read `indices` only for entries `0 <= i < count`;
callers that need stable entity IDs must explicitly opt into allocation:

```typescript
const snapshot = world.entities.querySnapshot(positionQuery);
const copied = world.entities.toArray(world.entities.queryList(positionQuery));
```

Other borrowed hot-path iterators follow the same rule:

```typescript
const active = world.entities.getActive();
const owners = world.components.getOwners(positionComponent);
const changed = world.components.getChanged(positionComponent);
```

Stable convenience snapshots are available for setup code, tools, debugging, and tests:

```typescript
const activeSnapshot = world.entities.getActiveSnapshot();
const ownerSnapshot = world.components.getOwnersSnapshot(positionComponent);
const changedSnapshot = world.components.getChangedSnapshot(positionComponent);
```

We can also access entities which have entered or exited the query since the last `world.refresh()`:

```typescript
const entered = world.archetypes.queryEntered(positionQuery);
const exited = world.archetypes.queryExited(positionQuery);
```


### Systems

Systems are functions which use queries to modify entity properties.

It is recommended (but not necessary) that all data mutation take place inside a system.

Author systems with `new System` and keyed component maps in `new Query`. The callback receives a typed component instance record:

```typescript
const movementSystem = new System({
  name: "movementSystem",
  query: new Query({
    all: { position: positionComponent, velocity: velocityComponent },
  }),
  callback: (components, entities, dt: number) => {
    const { position, velocity } = components;
    const positionStorage = position.storage.partitions;
    const velocityStorage = velocity.storage.partitions;

    for (let i = 0; i < entities.count; i++) {
      const entity = entities.indices[i];
      positionStorage.x[entity] += velocityStorage.x[entity] * dt;
      positionStorage.y[entity] += velocityStorage.y[entity] * dt;
    }
  },
});
```

System callbacks receive a borrowed `BorrowedEntityList`, the same dense view returned by `world.entities.queryList(...)`.
This is a breaking migration from iterator-style callbacks. Existing callback loops should change from:

```typescript
for (const entity of entities) {
  // ...
}
```

to:

```typescript
for (let i = 0; i < entities.count; i++) {
  const entity = entities.indices[i];
  // ...
}
```

`world.entities.query(...)` remains available as a convenience iterator API outside the system hot path.

`any` components are OR filters and are also exposed in the callback record. `include` components are exposed without
filtering membership. `none` components are query filters only:

```typescript
const renderSystem = new System({
  name: "renderSystem",
  query: new Query({
    all: { position: positionComponent },
    any: { sprite: spriteComponent },
    include: { facing: facingComponent },
    none: { hidden: hiddenComponent },
  }),
  callback: (components, entities) => {
    components.position; // ComponentInstance<Vec2>
    components.sprite; // ComponentInstance<Sprite>
    components.facing; // ComponentInstance<FacingValue, FacingStorage>
    // components.hidden is intentionally unavailable here.
    for (let i = 0; i < entities.count; i++) {
      const entity = entities.indices[i];
      if (components.facing.has(entity)) {
        const dir = components.facing.partitions.dir[entity];
      }
      // render...
    }
  },
});
```

#### Dynamic compatibility

Array-based `QuerySpec` values and `SystemCallback` remain supported for dynamic string/query based code. Dynamic component
records intentionally expose unknown schemas, so cast or narrow a component instance before touching concrete storage
properties:

```typescript
const positionSystem = new System({
  name: "positionSystem",
  query: positionQuery,
  callback: (components, entities) => {
    const position = components.position as ComponentInstance<Vec2>;
    const { x, y } = position.storage.partitions;
    for (let i = 0; i < entities.count; i++) {
      const entity = entities.indices[i];
      x[entity] += 1;
      y[entity] += 1;
    }
  },
});
```

Once created a system can be registered with the world:

```typescript
const systemInstance = world.systems.create(positionSystem);
```

Once registered, systems are then called like normal functions:

```typescript
systemInstance();
```


## Contributing

Contributions are welcome and encouraged. The aim of the project is performance - both in terms of speed and GC allocation pressure.

The benchmark suite covers the gameplay paths ECS users usually care about: world setup, repeated-add versus bundle
spawn/despawn lifecycle, multi-component destroy cleanup, archetype transitions, direct writes with manual changed
marking, allocation-free reads, included-component render loops, owner and changed iteration, cached and invalidated
queries, entered/exited query tracking, 64-component worlds, plain TypeScript data-layout baselines, system updates, and
whole-frame loops. It also has dedicated internal manager/cache throughput coverage plus retained memory and GC
allocation budget checks. Run public and internal throughput benchmarks with:

```bash
deno task bench
```

Run individual throughput suites with:

```bash
deno task bench:user
deno task bench:internal
```

Retained memory usage is measured separately because it uses V8's exposed GC hook to stabilize heap and ArrayBuffer
measurements:

```bash
deno task bench:memory
```

GC allocation pressure is measured separately because it requires V8's exposed GC hook and budget checks:

```bash
deno task bench:gc
```

Please run `deno task ci` before opening a PR. For performance-sensitive changes, also run `deno task bench` and
`deno task bench:all`.

## Feature Requests

Feature requests are welcome and invited. Please open an issue on Github to make a request.

## Acknowledgements

Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [BECSY](https://github.com/LastOliveGames/becsy), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs), and [Structurae](https://github.com/zandaqo/structurae).

## License

Miski is released under the MIT license. See `LICENSE` for further details.

&copy; 2024 The Miski Authors. All rights reserved.

See `AUTHORS.md` for author details.
****
