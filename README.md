# 🍬 Miski ECS

__Miski__: Quechuan adjective meaning "sweet".

__ECS__: Entity-Component-System; a software architecture pattern.

__Miski ECS__: A sweet ECS architecture written in Typescript.

⚠️ Miski is currently in alpha. Expect breaking changes every version until beta.

<p align="left">
  <img src="https://badgen.net/badge/icon/typescript?icon=typescript&label" alt="" />
  <img src="https://badgen.net/badge/license/MIT/blue" alt="" />
  <img src="https://img.shields.io/npm/v/miski.svg" alt="" />
</p>

## Contents
  * [Purpose](#purpose)
  * [Features](#features)
  * [Importing](#importing)
  * [API Reference](#quick-start-api-reference)
  * [Docs](#docs)
  * [Demos](#demos)
  * [Benchmarks](#benchmarks)
  * [Building](#building)
  * [To-Do](#to-do)
  * [Contributing](#contributing)
  * [Feature Requests](#feature-requests)
  * [Acknowledgements](#acknowledgements)
  * [License](#license)

## Purpose
Miski's purpose is to provide a stable, developer-friendly ECS architecture for modern Javascript projects.

### Goals
* To provide good and predictable performance
* To provide a developer-friendly API
* To provide a clean, readable, self-documenting, open-source codebase

### Not Goals
Because Miski is designed to be used inside your own projects, we let you configure bundling and performance tuning to suit your needs, therefore the following are not priorities of this project:
* To be the fastest or smallest ECS on the web
* To provide polyfills, workarounds, or older browser support for modern ECMAScript features

## Features
* Simple, developer-friendly, human-readable API
* Modern ES2020 data-oriented Typescript codebase
* Fast, cache-friendly ArrayBuffer-based component data storage
* Ability to use more than 32 components in one world using Uint32Array bitfields
* Ability to limit the number of entities a component can be added to
* Basic serialization methods (`world.load` & `world.save`)
* Use `component.changed` to get an iterator of entities whose properties were changed via `component.proxy`
* Define components, systems and queries once, reuse them across multiple worlds
* `AND`,`OR`,`NOT` operators in Queries
* `world.getQueryEntered` & `world.getQueryExited` methods
* No dependencies
* MIT license

## Importing
The javascript module `miski.min.js` is found in the `./dist` folder, along with a sourcemap file and typescript definitions `.d.ts` file.

```javascript
import { Component, Query, System, World } from './miski.min.js';
```

See [API Reference](#api-reference) below for a complete list of named exports.

Various type definitions are also exported - see `index.ts` for a complete list.

## Quick Start API Reference
Below are the essentials of the Miski API. For full documentation see `Docs` below.

Each concept in this reference builds on the previous concept, it should be read in order.

### World
The world object is the primary container for all things Miski.

⚠️ Components cannot be added to a world after its creation.

We can create a new world like so:

```typescript
const world = new World({
  capacity: 1000, // The maximum number of entities to allow in the world
  components: [
    positionComponent, // We'll create this in the components section below
  ],
});
```

The world requires frequent maintenance (i.e., once per frame):

```typescript
world.refresh();
```

### Components
A component is a data structure that gives entities their state.

Components can be created once and used across multiple worlds.

⚠️ There are a few names you cannot use for components or their schema properties. See `constants.ts`.

For example, to create a 2d position component:

```typescript
interface Vec2 = { x: number, y: number };
const positionComponent = new Component<Vec2>({
  name: "position",
  schema: {
    x: Float32Array,
    y: Float32Array,
  },
});
```

We can create a tag component by omitting the schema object:

```typescript
const activeComponent = new Component<null>({
  name: "active"
});
```

By default a component can be added to as many entities as the world's capacity, we can change this behavior like so:

```typescript
const player = new Component<null>({
  name: "player",
  maxEntities: 1,
});
```

We can add and remove components from entities like so:

```typescript
// Create the adder factory:
const addPositionToEntity = world.addComponentsToEntity(positionComponent); // you can provide multiple components here.

// Add the component to an entity:
addPositionToEntity(entity);
```
```typescript
// Create the remover factory:
const removePositionFromEntity = world.removeComponentFromEntity(positionComponent) // you can provide multiple components here.

// Remove the component from an entity:
removePositionFromEntity(entity);
```

We can also test if entities have components:

```typescript
// Has a single component?
const hasPosition: boolean = world.hasComponent(positionComponent)(entity);

// Has multiple components?
const hasXYZ: boolean[] = world.hasComponents(positionComponent, ...)(entity);
```

To access the component's data relevant to a specific world, we have to get the ComponentInstance, like so:

```typescript
// returns ComponentInstance<T> or undefined
const positionInstance = world.getComponentInstance(positionComponent);

// For multiple components: (ComponentInstance<unknown> | undefined)[]
const instances = world.getComponentInstances(positionComponent, ...);
```

The component instance is accessible quickly using Systems (see below).

Once we have the component instance we can modify entity properties.

There are two ways to do this:

The first is quick but unsafe:

```typescript
positionInstance.x[entity] = 1;
```

The second is slower but safer:

```typescript
positionInstance.proxy.entity = entity;
positionInstance.proxy.x = 1;
```

The second way, using `.proxy` has the advantage of also adding the entity to the `.changed` array as well as performing some basic typeguarding.

For example:

```typescript
positionInstance.x[101] = 1;

positionInstance.proxy.entity = 444;
positionInstance.proxy.x = 1;

[...positionInstance.changed] = [444] // does not include entity 101
```

N.B. The `.changed` array is reset with every `world.refresh()`.

You can also access the changed entities of a component like so:

```typescript
const changed = world.getChangedFromComponents(positionComponent);
```

### Entities
Entities are just integers. They are essentially indexes or pointers into various arrays in the world.

```typescript
// Create (will return undefined if no entities are available)
const entity = world.createEntity();
// Destroy
world.destroyEntity(entity);
// Test if entity is active in the world
world.isEntityActive(entity);
// Test if an entity is valid in the world
world.isValidEntity(4235); // will return false if the world capacity is 1000 as above
// Get the number of active entities in a world
const active = world.residents;
// Get the number of remaining available entities in a world
const available = world.available;
// Get all the component properties for an entity in a world
const props = world.getEntityProperties(entity);
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
const components = world.getQueryComponents(positionQuery);
const entities = world.getQueryEntities(positionQuery);
```

We can also access entities which have entered or exited the query since the last `world.refresh()`:

```typescript
const entered = world.getQueryEntered(positionQuery);
const exited = world.getQueryExited(positionQuery);
```

`getQueryEntities`, `getQueryEntered`, and `getQueryExited` optionally take an array as a second argument to avoid creating a new underlying array each time, reducing GC cost.

### Systems
Systems are functions which use queries to modify entity properties.

It is recommended (but not necessary) that all data mutation take place inside a system.

```typescript
const positionSystemPrefab = new System({
  query: positionQuery,
  system: (components, entities) => {
    const { position } = components;
    const { x, y } = position;
    for (const entity of entities) {
      x[entity] += 1;
      y[entity] += 1;
    }
  },
});
```

Once created a system can be initialized into worlds which helps with caching etc.:

```typescript
const positionSystem = positionSystemPrefab.init(world);
```

Once initialized, systems are then used just like normal fuctions:

```typescript
positionSystem();
```

## Docs
See `./docs` or <a href="https://phughesmcr.github.io/Miski/docs/index.html">the live docs page on Github</a>.

## Demos
See `./demo` for demo code or <a href="https://phughesmcr.github.io/Miski/">the demo page</a> for live examples.

## Building
To build Miski from source, run:

```bash
git clone https://github.com/phughesmcr/Miski.git
cd Miski
npm install
npm run build
```

## To-Do
### Before Beta
1. Finalise API
2. Write comprehensive tests
3. Write consistent code documentation throughout
### Before 1.0.0
1. Optimise performance
2. Consistent code style throughout
3. Object pooling where necessary
### Future
1. Multithreading support / playing nicely with WebWorkers / SharedArrayBuffers
2. Proper Deno support

## Contributing
Contributions are welcome and invited. See `CONTRIBUTING.md` for details.

If you want inspiration, there are plenty of `/** @todo */` comments in the code.

## Feature Requests
Feature requests are welcome and invited. Please open an issue on Github to make a request.

## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [BECSY](https://github.com/LastOliveGames/becsy), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs), and [Structurae](https://github.com/zandaqo/structurae).

## License
Miski ECS is released under the MIT license. See `LICENSE` for further details.

&copy; 2021-2022 The Miski Authors. All rights reserved.

See `AUTHORS.md` for author details.
