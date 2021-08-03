# Ⓜ Miski ECS

*__Miski__: Quechuan adjective meaning "sweet"*.

*__Miski ECS__: A sweet ECS architecture written in Typescript.*

Miski is currently in alpha. Expect breaking changes every version until beta.

## Contents
  * [Purpose](#purpose)
    + [Goals](#goals)
    + [Not Goals](#not-goals)
  * [Features](#features)
  * [Install](#install)
    + [Browser etc.](#browser-etc)
    + [npm](#npm)
  * [Example](#example)
  * [API Reference](#api-reference)
  * [Demos](#demos)
  * [Benchmarks](#benchmarks)
  * [To-Do](#to-do)
  * [Contributing](#contributing)
  * [Acknowledgements](#acknowledgements)
  * [License](#license)

## Purpose
Miski's purpose is to provide a stable, user-friendly ECS architecture for modern browsers.

### Goals
* To provide a stable, explicit, user-friendly API
* To provide reasonable and relatively predictable performance
* To provide a clean, readable, self-documenting, open-source code base

### Not Goals
* To be the fastest or smallest ECS on the web
* To provide support for the majority of web users or web environments
* To provide polyfills, workarounds, or older browser support for modern ECMAScript features

## Features
* Simple, functional, human-friendly API
* Ability to use more than 32 components in one world
* Direct or Type-safe getters and setters for component properties
  * e.g., `position.x[entity] = 100;` or `setDataInStore(position.x, entity, 100);` or `position.x.setProp(entity, 100);`
* Define components and systems once, reuse them across worlds
* Lots of unit tests

## Install
See [API Reference](#api-reference) below for a complete list of named exports.

### Browser etc.
`CJS`, `ES2020`, `ESM`, `IIFE` and `UMD` builds are available in the `./dist` folder.

`ES2020` builds are `ESM` builds that have not been processed by Babel.

Miski can then be used through its named exports:

```javascript
import { createWorld } from './es2020/index.min.js';
const world = createWorld();
```
or for UMD/IIFE:
```javascript
<script src="./es2020/index.min.js" type="module">
...
const world = miski.createWorld();
```

### npm
```bash
npm install --production miski
```
```javascript
const miski = require('miski');
```

## Example
Creates some boxes that bounce around a canvas while changing colour:

```javascript
  const SPEED = 10;
  const canvas = document.getElementsByTagName('canvas')[0];
  const ctx = canvas.getContext('2d');
  function rnd(a, b) { return Math.random() * (b - a) + a; }

  // 1. Create a world

  const world = createWorld();
  window.world = world; // useful for debugging

  // 2. Define components

  const cColour = createComponent({ name: "colour", schema: { r: ui8, g: ui8, b: ui8 }});
  const cPosition = createComponent({ name: "position", schema: { x: f32, y: f32 }});
  const cSize = createComponent({ name: "size", schema: { value: ui32 }});
  const cVelocity = createComponent({ name: "velocity", schema: { dx: f32, dy: f32 }});

  // 3. Register components

  const iSize = await registerComponent(world, cSize);
  const iPosition = await registerComponent(world, cPosition);
  const iColour = await registerComponent(world, cColour);
  const iVelocity = await registerComponent(world, cVelocity);

  // 4. Create Entities and give them some components

  for (let i = 0, max = 32; i < max; i++) {
    const box = createEntity(world);
    await addComponentToEntity(iSize, box, { value: rnd(25, 125) });
    await addComponentToEntity(iPosition, box, { x: rnd(125, canvas.width - 125), y: rnd(125, canvas.height - 125) });
    await addComponentToEntity(iColour, box, { r: rnd(0, 255), g: rnd(0, 255), b: rnd(0, 255) });
    await addComponentToEntity(iVelocity, box, { dx: rnd(-10, 10), dy: rnd(-10, 10) });
  }

  // 5. Create queries to group objects by components for use in systems

  const qColour = createQuery({all: [ cColour, cSize, cPosition, cVelocity ]});
  const qRender = createQuery({all: [ cSize, cColour, cPosition ]});

  // 6. Define Systems

  const sColourChange = createSystem({
    name: "colour",
    update: function(entities, components, delta) {
      const { colour, position, size, velocity } = components;
      const { r, g, b } = colour;
      const { x, y } = position;
      const { value } = size;
      const { dx, dy } = velocity;

      entities.forEach((entity) => {
        // data for entities can be got/set in 3 ways:
        // direct but type unsafe:
        r[entity] += 1;
        // indirect but more type safe:
        setDataInStore(g, entity, getDataFromStore(g, entity) + 1);
        b.setProp(entity, b.getProp(entity) + 1);

        // bounce box off sides of canvas
        const ds = value[entity];
        const nx = x[entity] + dx[entity] * delta * SPEED;
        const ny = y[entity] + dy[entity] * delta * SPEED;
        if (nx >= canvas.width - ds || nx <= 0) {
          dx[entity] = -dx[entity];
        }
        if (ny >= canvas.height - ds || ny <= 0) {
          dy[entity] = -dy[entity];
        }

        // update position
        x[entity] += dx[entity] * delta * SPEED;
        y[entity] += dy[entity] * delta * SPEED;
      });
    },
  });

  const sRender = createSystem({
    name: "render",
    post: function(entities, components, alpha) {
      const { colour, position, size } = components;
      const { r, g, b } = colour;
      const { x, y } = position;
      const { value } = size;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      entities.forEach((entity) => {
        ctx.fillStyle = `rgb(${r[entity]}, ${g[entity]}, ${b[entity]})`;
        ctx.fillRect(x[entity], y[entity], value[entity], value[entity]);
      });
    }
  });

  // 7. Register Systems

  const iColourChange = await registerSystem(world, sColourChange, qColour);
  enableSystem(iColourChange); // systems are disabled by default

  const iRender = await registerSystem(world, sRender, qRender);
  enableSystem(iRender);

  // 8. Define your game loop (not Miski specific)

  let stepLastTime = null;
  let stepAccumulator = 0;
  let stepLastUpdate = 0;
  const tempo = 1 / 60;
  const maxUpdates = 240;

  function step(time) {
    requestAnimationFrame(step);
    if (stepLastTime !== null) {
      stepAccumulator += (time - (stepLastTime || 0)) * 0.001;
      stepLastUpdate = 0;

      runPreSystems(world); // calls all systems' pre() function

      while (stepAccumulator > tempo) {
        if (stepLastUpdate >= maxUpdates) {
          stepAccumulator = 1;
          break;
        }

        runUpdateSystems(world, tempo); // calls all systems' update() function

        stepAccumulator -= tempo;
        stepLastUpdate++;
      }
    }
    stepLastTime = time;
    const alpha = stepAccumulator / tempo;

    runPostSystems(world, alpha); // calls all systems' post() function
  }
  requestAnimationFrame(step);
```

## API Reference
This is the complete API:

```javascript
  🌍 World
  createWorld(WorldSpec) => World;

  🧩 Components (T: schema)
  createComponent(ComponentSpec<T>) => Component<T>;
  registerComponent(World, Component<T>) => ComponentInstance<T>
  unregisterComponent(ComponentInstance<T>) => World;
  addComponentToEntity(ComponentInstance<T>, Entity, properties?) => ComponentInstance<T>;
  removeComponentFromEntity(ComponentInstance<T>, Entity) => ComponentInstance<T>;

  👾 Entities (an Entity is just a number)
  createEntity(World) => Entity | undefined;
  destroyEntity(World, Entity) => boolean;

  🔎 Queries
  createQuery(QuerySpec) => Query;

  📜 Schema DataStores (T: array type, D: acceptable types)
  defineDataStore(DataStoreSpec<T, D>) => DataStore;
  getDataFromStore(DataStoreInstance<T, D>, Entity) => D | undefined;
  setDataInStore(DataStoreInstance<T, D>, Entity, <D>value) => boolean;

  ⚡ Systems
  createSystem(SystemSpec) => System;
  registerSystem(World, System) => SystemInstance;
  unregisterSystem(SystemInstance) => World;
  disableSystem(SystemInstance) => SystemInstance;
  enableSystem(SystemInstance) => SystemInstance;
  isSystemEnabled(SystemInstance) => SystemInstance;

  ⌚ Timestep
  runPreSystems(World) => void;
  runUpdateSystems(World) => void;
  runPostSystems(World) => void;

  🔨 Utils
  isValidComponent(object) => boolean;
  isValidName(string) => boolean;
  isValidSchema(Schema) => boolean;
```

Miski also comes with a set of data storage schemas for commonly used types:

* Typed array storage: `i8, ui8, ui8c, i16, ui16, i32, ui32, i64, ui64, f32, f64`

* Regular storage: `array, boolean, function, number, object, string`

* Unsafe storage: `any`

These can be used when defining components:

```javascript
  import { createComponent, f32 } from 'miski';
  const position = createComponent({
    name: "position",
    schema: {
      x: f32,
      y: f32,
    }
  });
```

## Demos
See `./demo` for working examples.

## To-Do
### Before Beta
1. Finalise API
### Before 1.0.0
1. Write comprehensive tests
2. Ensure high-quality Typescript definitions throughout
3. Write consistent code documentation throughout
4. Validation for any user supplied arguments
5. Optimise performance
### Future
1. Allow for "changed" in queries
2. Serialisation
3. Multithreading support / playing nicely with WebWorkers / SharedArrayBuffers


## Contributing
Feature requests are welcome. Please open an issue on Github to make a request.

Contributions are welcome and invited. See `CONTRIBUTING.md` for details.

## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), and [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs).

## License
&copy; 2021 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.
