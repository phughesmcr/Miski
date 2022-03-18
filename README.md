# 🍬 Miski ECS

__Miski__: Quechuan adjective meaning "sweet".

__ECS__: Entity-Component-System; A software architecture pattern.

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
  * [API Reference](#api-reference)
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
Because Miski is designed to be used inside your own projects, we let you configure bundling and performance tuning to suit your needs, therefore the following are not goals of this project:
* To be the fastest or smallest ECS on the web
* To provide polyfills, workarounds, or older browser support for modern ECMAScript features

## Features
* Simple, developer-friendly, human-readable API
* Modern ES2020 data-oriented Typescript codebase
* No dependencies
* Sensible by default
* Memory-friendly archetype-based ECS model
* Ability to use more than 32 components in one world using Uint32Array bitfields
* Ability to limit the number of entities a component can be added to
* Ability to use multiple queries per system
* Basic serialization methods (`world.load` & `world.save`)
* Fast, cache-friendly ArrayBuffer-based component data storage
* Use `component.changed` to get an iterator of entities whose properties were changed via `component.proxy`
* Define components and queries once, reuse them across multiple worlds
* `AND`,`OR`,`NOT` operators in Queries
* `world.getQueryEntered` & `world.getQueryExited` methods
* MIT license

## Importing
The javascript module `miski.min.js` is found in the `./dist` folder, along with a sourcemap file and typescript definitions `.d.ts` file.

```javascript
import { createComponent, createQuery, createSystem, createWorld } from './miski.min.js';
```

See [API Reference](#api-reference) below for a complete list of named exports.

Various type definitions are also exported - see `index.ts` for a complete list.

## API Reference
This is the complete API:

```typescript
🧩 Components // Schema = Record<string, TypedArrayConstructor>. E.g., { r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray };
createComponent: <T extends Schema<T>>(spec: ComponentSpec<T>) => Component<T>;

🔎 Queries
createQuery: (spec: QuerySpec) => Query;
mergeQueries: (...queries: Query[]) => Query;

🔃 Systems // optional but helps with type safety - A system is a function of any arity where the first two parameters are a component record and entity array
createSystem: <T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirst<T>>(system: System<T, U>, queries: Query): (world: World) => (...args: U) => ReturnType<T>;

🌍 World
createWorld: (spec: WorldSpec) => World;

  ❓ World info
  world.capacity: number; // Maximum number of Entities
  world.getVacancyCount: () => number; // Number of available (i.e., unused) Entities
  world.version: string; // Miski build version

  👾 World Entity methods // ('Entity' is just a type alias for 'number')
  world.createEntity: () => Entity | undefined;
  world.destroyEntity: (entity: Entity) => boolean;
  world.hasEntity: (entity: Entity) => boolean;
  world.getEntityArchetype: (entity: Entity) => Archetype | undefined;
  world.getEntityProperties: (entity: Entity) => SchemaProps<unknown>;

  🧩 World Component methods
  world.addComponentToEntity: <T>(component: Component<T>) => (entity: Entity, props?: SchemaProps<T>) => boolean;
  world.addComponentsToEntity: (...components: Component<unknown>) => (entity: Entity) => boolean[];
  world.removeComponentFromEntity: <T>(component: Component<T>) => (entity: Entity) => boolean;
  world.removeComponentsFromEntity: (...components: Component<unknown>) => (entity: Entity) => boolean[];
  world.hasComponent: <T>(component: Component<T>) => (entity: Entity) => boolean;
  world.withComponents: (...components: Component<unknown>[]) => (...entities: Entity) => Entity[];

  🔎 World Query methods
  world.getQueryResult: (query: Query) => [Entity[], ComponentRecord];
  world.getQueryResults: (...queries: Query[]) => [Entity[], ComponentRecord];
  world.getQueryEntered: (query: Query) => Entity[];
  world.getQueryExited: (query: Query) => Entity[];

  💾 World serialization methods
  world.load: (data: MiskiData) => boolean;
  world.save: () => Readonly<MiskiData>;

  🔧 World maintenance methods
  world.refresh: () => void;
  world.purgeCaches: () => void;
```

## Docs
See `./docs` or <a href="https://phughesmcr.github.io/Miski/docs/index.html">the live docs page on Github</a>.

## Demos
See `./demo` for demo code or <a href="https://phughesmcr.github.io/Miski/">the demo page</a> for live examples.

## Benchmarks
Soon™️

## Building
To build Miski from source, run:

```bash
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
3. Dynamic component data storage

## Contributing
Contributions are welcome and invited. See `CONTRIBUTING.md` for details.

## Feature Requests
Feature requests are welcome and invited. Please open an issue on Github to make a request.

## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [BECSY](https://github.com/LastOliveGames/becsy), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), and [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs).

## License
&copy; 2021-2022 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.
