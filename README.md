# Ⓜ Miski ECS

*__Miski__: Quechuan adjective meaning "sweet"*.

*__Miski ECS__: A sweet ECS architecture written in Typescript.*

Miski is currently in alpha. Expect breaking changes every version until beta.

## Contents
  * [Purpose](#purpose)
    + [Goals](#goals)
    + [Not Goals](#not-goals)
  * [Install](#install)
    + [Browser etc.](#browser-etc)
    + [npm](#npm)
  * [Example](#example)
  * [Demos](#demos)
  * [Benchmarks](#benchmarks)
  * [To-Do](#to-do)
  * [Contributing](#contributing)
  * [Acknowledgements](#acknowledgements)
  * [License](#license)

## Purpose
Miski's purpose is to provide a stable ECS architecture for modern browsers.

### Goals
* To provide a stable, explicit, declarative API
* To provide reasonable, predictable performance

### Not Goals
* To be the fastest / smallest ECS on the web
* To provide support for the majority of web users / web environments
* To provide polyfills / workarounds / older browser support etc. for modern ECMAScript features

## Install

### Browser etc.
`CJS`, `ESM`, `IIFE` and `UMD` builds are available in the `./dist` folder.

### npm
```bash
npm install --production miski
```

## Example

```javascript
import { createComponent, createWorld, Types } from 'miski';
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

// create our world - most functions take place through the world object
const world = createWorld({
  maxComponents: 256,
  maxEntities: 100_000,
  maxUpdates: 240,
  tempo: 1 / 60,
});

// useful for debugging
window.world = world;

// define some components:
// components are reusable and not tied to a world instance
const size = createComponent({
  name: "size",
  schema: {
    height: Types.f32,
    width: Types.f32,
  },
});

// we register components to a world like so:
const iSize = world.registerComponent(size);
// this returns a ComponentInstance for use in queries

// lets continue making and registering components
const colour = createComponent({
  name: "colour",
  schema: {
    r: Types.u8c,
    g: Types.u8c,
    b: Types.u8c,
  },
});
const iColour = world.registerComponent(colour);

const position = createComponent({
  name: "position",
  schema: {
    height: Types.f32,
    width: Types.f32,
  },
});
const iPosition = world.registerComponent(position);

// create our box entity - createEntity takes no arguments
const box = world.createEntity();

// add the components to the entity
box.addComponent(iColour);
box.addComponent(iPosition);
box.addComponent(iSize);

// set some initial properties
iPosition.x[box] = 10;
iPosition.y[box] = 50;
iColour.r[box] = 255;
iColour.g[box] = 0;
iColour.b[box] = 0;
iSize.height[box] = 100;
iSize.width[box] = 100;

// world systems support three functions
// 1) a pre-update function   - ("pre")     - run once at the start of each frame
// 2) an update function      - ("update")  - to potentially be called multiple times per frame
// 3) a post-update function  - ("post")    - run once at the end of each frame

// a simple update function to move boxes around the canvas
function moveBoxes(entities, delta) {
  entities.forEach((entity) => {
    // modify component properties
    iPosition.x[entity] += (10 * delta);
    iPosition.y[entity] -= (10 * delta);
  });
}

// a simple render function to draw the boxes to the canvas
function draw(entities, alpha) {
  // clear canvas every frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // draw each entity
  entities.forEach((entity) => {
    ctx.fillStyle = `rgb(${iColour.r[entity]}, ${iColour.g[entity]}, ${iColour.b[entity]})`;
    ctx.fillRect(
      iPosition.x[entity],
      iPosition.y[entity],
      iSize.width[entity],
      iSize.height[entity],
    );
  });
}

// Use queries to gather entities for use in systems:
const qBox = world.registerQuery({
  all: [
    colour,
    position,
    size
  ],
  // also takes 'any' and 'none' arrays like Geotic
});

// turn the mover function into a system
const mover = world.registerSystem({
  // system name can be any valid object property name
  name: "mover",
  query: qBox,
  update: moveBoxes,
  post: draw,
});

// enable the system
mover.enable();

// game loop example
let lastTime = null;
let accumulator = 0;
const tempo = 1/60;
let dt = tempo;

function onTick(time) {
  world.step(time);
  window.requestAnimationFrame(onTick);
}
onTick(0);
```

## Demos
See `./demo` for more interesting working examples.

## To-Do
### Before Beta
1. Finalise API
### Before 1.0.0
1. Write comprehensive tests
2. Ensure high-quality Typescript definitions throughout
3. Write consistent code documentation throughout
### Future
1. Allow for "changed" in queries
2. Use of Async where appropriate
3. Multithreading support / playing nicely with WebWorkers / SharedArrayBuffers

Feature requests are welcome. Please open an issue on Github to make a request.

## Contributing
Contributions are welcome and invited. See `CONTRIBUTING.md` for details.

## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), [Wolf ECS](https://github.com/EnderShadow8/wolf-ecs), and [classless.md](https://gist.github.com/mpj/17d8d73275bca303e8d2)

## License
&copy; 2021 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.
