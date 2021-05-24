# Ⓜ Miski ECS

*__Miski__: Quechuan adjective meaning "sweet"*.

*__Miski ECS__: A sweet ECS architecture written in Typescript.*

Miski is currently in alpha. Expect breaking changes every version until beta.

## Contents
  * [Requirements](#requirements)
  * [Install](#install)
    + [Browser etc.](#browser-etc)
    + [npm](#npm)
  * [Example](#example)
    + [Demos and Benchmarks](#demos-and-benchmarks)
  * [To-Do](#to-do-before-100-release)
  * [Acknowledgements](#acknowledgements)
  * [License](#license)

## Requirements
Miski requires `BigInt` support.

## Install

### Browser etc.
`CJS`, `ESM`, `IIFE` and `UMD` builds are available in the `./dist` folder.

### npm
```bash
npm install --production miski
```

```javascript
import { createWorld } from "../../dist/esm/index.min.js";
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

// create our world - most functions take place through the world object
const world = createWorld({
  entityPoolGrowthFactor: 0.25,
  initialEntityPoolSize: 128,
  maxComponents: 256,
  maxEntities: Number.POSITIVE_INFINITY,
  maxUpdates: 240,
  tempo: 1 / 60,
});

// useful for debugging
window.world = world;

// define some components
const size = world.registerComponent({
  // component name can be any valid object property name
  name: "size",
  defaults: {
    height: 100,
    width: 100,
  },
});

const colour = world.registerComponent({
  name: "colour",
  defaults: {
    r: 255,
    g: 0,
    b: 0,
  },
});

const position = world.registerComponent({
  name: "position",
  defaults: {
    x: 0,
    y: 0,
  },
});

// create our box entity - createEntity takes no arguments
const box = world.createEntity();
box.enable();

// add the components to the entity
box.addComponent(colour);
box.addComponent(position);
box.addComponent(size);

// overwrite some of the default properties with entity specific properties
box.colour = { r: 10, g: 255, b: 111 }; // rewriting the whole object is possible
box.position.x = 100;                    // but this way is preferred
box.position.y = 250;

// world systems support three functions
// 1) a pre-update function   - ("pre")     - run once at the start of each frame
// 2) an update function      - ("update")  - to potentially be called multiple times per frame
// 3) a post-update function  - ("post")    - run once at the end of each frame

// a simple update function to move boxes around the canvas
// N.B. update functions you intend to use as systems must take the following:
//     entities {Entity[]} an array of entities
//     global {Entity} the world.global entity
//     dt {number} frame delta time
function moveBoxes(entities, global, dt) {
  // its generally a good idea to bail early if no entities are affected
  if (!entities.length) return;
  entities.forEach((entity) => {
    // modify component properties
    entity.position.x += (10 * dt);
    entity.position.y -= (10 * dt);
  });
}

// a simple render function to draw the boxes to the canvas
// N.B. function you intend to use as a post-update function must take the following:
//     entities {Entity[]} an array of entities
//     global {Entity} the world.global entity
//     int {number} frame interpolation amount
function draw(entities, global, int) {
  // clear canvas every frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // draw each entity
  entities.forEach((entity) => {
    if (entity.enabled === true) {
      ctx.fillStyle = `rgb(${entity.colour.r}, ${entity.colour.g}, ${entity.colour.b})`;
      ctx.fillRect(
        entity.position.x,
        entity.position.y,
        entity.size.width,
        entity.size.height,
      );
    }
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

### Demos
See `./demo` for more interesting working examples.

### Benchmarks
Coming soon™

## Goals
* To provide a stable, readable ECS architecture using ES2020+ features
* To provide a high level of customisability

## Not Goals
* To be the fastest / smallest ECS on the web
* To conform a particular style of coding - function over form
* To support the majority of web users / web environments
* To provide polyfils / workarounds etc. for ES2020+ features / older browser support


## To-Do Before 1.0.0 release
### General
0. Decide between object / integer based entities
1. Finalise core API
2. Write comprehensive tests
3. Write consistent code documentation throughout
4. Write argument validation for all functions requiring user input
5. Ensure high-quality Typescript definitions throughout
### Features
1. Add schemas and schema validation for component properties
2. Ensure Typescript definitions work consistently
3. Allow for deferred removal of entities, components and systems
4. Allow for "changed" and "not" in queries
5. Add a plugin support system


## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), and [classless.md](https://gist.github.com/mpj/17d8d73275bca303e8d2)

## License
&copy; 2021 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.
