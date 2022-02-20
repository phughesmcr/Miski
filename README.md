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
  * [Install](#install)
  * [API Reference](#api-reference)
  * [Demos](#demos)
  * [Benchmarks](#benchmarks)
  * [Building](#building)
  * [To-Do](#to-do)
  * [Contributing](#contributing)
  * [Feature Requests](#feature-requests)
  * [Acknowledgements](#acknowledgements)
  * [License](#license)

## Purpose
Miski's purpose is to provide a stable, user-friendly ECS architecture for modern Javascript projects.

### Goals
* To provide good and predictable performance
* To provide a user-friendly API
* To provide a clean, readable, self-documenting, open-source codebase

### Not Goals
Because Miski is designed to be used inside other projects, we'll let those devs configure bundling and tune performance to suit their needs, therefore the following are not goals of this project:
* To be the fastest or smallest ECS on the web
* To provide polyfills, workarounds, or older browser support for modern ECMAScript features

## Features
* Simple, human-friendly API
* Modern ES2020 data-oriented Typescript codebase
* No dependencies
* Memory-friendly archetype-based ECS model
* Ability to use more than 32 components in one world using Uint32Array bitfields
* Basic serialization methods (`world.load` & `world.save`)
* Fast, cache-friendly ArrayBuffer-based component data storage
* Define components and queries once, reuse them across multiple worlds
* `AND`,`OR`,`NOT` operators in Queries

## Install
The javascript module `miski.min.js` is found in the `./dist` folder, along with a sourcemap file and typescript definitions `.d.ts` file.

```javascript
import { createComponent, createQuery, createSystem, createWorld } from './miski.min.js';
```

See [API Reference](#api-reference) below for a complete list of named exports.

Various type definitions are also exported - see index.ts for a complete list.

## API Reference
This is the complete API:

```typescript
🧩 Components // Schema = Record<string, TypedArrayConstructor>. E.g., { r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray };
createComponent: <T extends Schema<T>>(spec: ComponentSpec<T>) => Component<T>;

🔎 Queries
createQuery: (spec: QuerySpec) => Query;

🔃 Systems // optional but helps with type safety - A system is a function of any arity where the first parameter is the World
createSystem: <T, U>(system: System<T, U>) => (world: World) => (...args: U) => ReturnType<T>;

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
  world.entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;

  🧩 World Component methods
  world.addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>) => boolean;
  world.removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;

  🔎 World Query methods
  world.getQueryResult: (query: Query) => [Entity[], ComponentRecord];
  world.getQueryEntered: (query: Query) => [Entity[], ComponentRecord];
  world.getQueryExited: (query: Query) => [Entity[], ComponentRecord];

  💾 World serialization methods
  world.load: (data: MiskiData) => boolean;
  world.save: () => Readonly<MiskiData>;

  🔧 World maintenance methods
  world.refresh: () => void;
```

## Demos
See `./demo` for working examples.

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
3. Ensure high-quality Typescript definitions throughout
4. Write consistent code documentation throughout
5. Validation for any user supplied arguments
### Before 1.0.0
1. Optimise performance
2. Consistent code style throughout
### Future
1. Allow for "changed" in queries
2. Serialisation
3. Multithreading support / playing nicely with WebWorkers / SharedArrayBuffers
4. Proper Deno support
5. Resizable/dynamic component data storage
6. Object pooling where necessary

## Contributing
Contributions are also welcome and invited. See `CONTRIBUTING.md` for details.

## Feature Requests
Feature requests are welcome and invited. Please open an issue on Github to make a request.

## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [BECSY](https://github.com/LastOliveGames/becsy), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), and [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs).

## License
&copy; 2021-2022 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.
