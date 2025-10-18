# 🍬 Miski ECS

__Miski__: Quechuan adjective meaning "sweet".

__ECS__: Entity-Component-System; a software architecture pattern.

__Miski ECS__: A sweet, high-performance ECS library written in Typescript.

See [jsr.io/@phughesmcr/miski](https://jsr.io/@phughesmcr/miski) for complete documentation.

<p align="left">
  <img src="https://badgen.net/badge/license/MIT/blue" alt="MIT License" />
  <img src="https://badgen.net/badge/icon/typescript?icon=typescript&label" alt="Written in Typescript">
  <img src="https://img.shields.io/badge/deno-^2.1.0-lightgrey?logo=deno" alt="Deno version" />
  <img src="https://img.shields.io/badge/bun-%5E1.1.0-lightgrey?logo=bun" alt="Bun version" />
  <img src="https://img.shields.io/badge/node-%5E22.0.0-lightgrey?logo=node.js" alt="Node version" />
</p>

*Note*: The runtime versions above are indicative, Miski should work on any modern JavaScript runtime.

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

* Modern modular ES2022 data-oriented Typescript codebase
* Fast, cache-friendly ArrayBuffer-based component data storage
* Simple, developer-friendly, human-readable API
* Ability to register more than 32 components in one world
* Ability to limit the number of entities a component can be added to
* Define components, systems and queries once, reuse them across multiple worlds
* `AND`,`OR`,`NOT` operators in Queries
* `world.getQueryEntered` & `world.getQueryExited` methods
* Use `component.changed` to get an iterator of entities whose properties were changed via `component.proxy`
* No 3rd-party dependencies
* MIT license

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

## Quick Start API Reference

Below are the essentials of the Miski API. For full API documentation see [jsr.io/@phughesmcr/miski](https://jsr.io/@phughesmcr/miski).

Each concept in this reference builds on the previous concept, it should be read in order.

### World

The world object is the primary container for all things Miski.

We can create a new world like so:

```typescript
const world = new World({
  capacity: 1000, // The maximum number of entities to allow in the world
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

#### Test for Component presence

We can also test if entities have components:

```typescript
// Check if an entity has a component
const hasPosition: boolean = world.components.entityHas(positionComponent, entity);
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

The first is quick but unsafe (no change tracking):

```typescript
positionInstance.storage.partitions.x[entity] = 1;
```

The second is slower but safer (with change tracking and type guards):

```typescript
positionInstance.proxy.entity = entity;
positionInstance.proxy.x = 1;
```

The second way, using `.proxy` has the advantage of also adding the entity to the changed tracking as well as performing some basic typeguarding.

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
});
```

We can then access the entities and components which match our query:

```typescript
const components = world.components.query(positionQuery);
const entities = world.entities.query(positionQuery);
```

We can also access entities which have entered or exited the query since the last `world.refresh()`:

```typescript
const entered = world.archetypes.queryEntered(positionQuery);
const exited = world.archetypes.queryExited(positionQuery);
```


### Systems

Systems are functions which use queries to modify entity properties.

It is recommended (but not necessary) that all data mutation take place inside a system.

```typescript
const positionSystem = new System({
  name: "positionSystem",
  query: positionQuery,
  callback: (components, entities) => {
    const { position } = components;
    const { x, y } = position.storage.partitions;
    for (const entity of entities) {
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

Please run `deno test`, `deno bench` and `deno task prep` to run tests, benchmarks, and formatting before committing.

## Feature Requests

Feature requests are welcome and invited. Please open an issue on Github to make a request.

## Acknowledgements

Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [BECSY](https://github.com/LastOliveGames/becsy), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs), and [Structurae](https://github.com/zandaqo/structurae).

## License

Miski is released under the MIT license. See `LICENSE` for further details.

&copy; 2024 The Miski Authors. All rights reserved.

See `AUTHORS.md` for author details.
****
