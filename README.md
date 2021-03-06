# Ⓜ Miski ECS

*__Miski__: Quechuan adjective meaning "sweet"*.

*__Miski ECS__: A sweet ECS architecture written in Typescript.*

Miski is currently in alpha. Expect breaking changes every version until beta.

## Install

`CJS`, `ESM`, `IIFE` and `UMD` builds are available in the `./dist` folder.

**Miski requires `BigInt` support.**

### npm
```bash
npm install --production miski
```

```javascript
import { createWorld } from "miski";
// OR
const miski = require("miski");
```

## Usage

A simple box on a 2d canvas example:

```javascript
import { createWorld } from 'miski';
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

// create our world - most functions take place through the world object
const world = createWorld({
  initialPoolSize: 64,
  maxComponents: 1024,
  maxEntities: 1000000;
});

// define some components - the properties given here are the default properties of the component
const size = world.registerComponent({
  name: "size",
  properties: {
    height: 100,
    width: 100,
  },
});

const colour = world.registerComponent({
  name: "colour",
  properties: {
    r: 255,
    g: 0,
    b: 0,
  },
});

const position = world.registerComponent({
  name: "position",
  properties: {
    x: 0,
    y: 0,
  },
});

// create our box entity - createEntity takes no arguments
const box = world.createEntity();

// add the components to the entity
world.addComponentsToEntity(box, size, colour, position);

// overwrite some of the default properties with entity specific properties
// access components through the "_" shorthand property
// N.B. you can access the individual properties of course (e.g. box._.colour.r)
box._.colour = { r: 150, g: 150, b: 150 };
box._.position = { x: 100, y: 250 };

// world systems support three functions
// 1) a pre-update function - ("preUpdate") - run once at the start of each frame
// 2) an update function - ("update") - to potentially be called multiple times per frame
// 3) a post-update function - ("postUpdate) - run once at the end of each frame

// a simple update function to move boxes around the canvas
// N.B. update functions you intend to use as systems must take the following:
//     dt {number} frame delta time
//     entities {Entity[]} an array of entities
//     system {System} the system calling this function
function moveBoxes(dt, entities, system) {
  // its generally a good idea to bail early if no entities are affected
  if (!entities.length) return;
  entities.forEach((entity) => {
    // modify component properties
    entity.components.position.x += (0.5 * dt),
    entity.components.position.y -= (0.5 * dt),
  });
}

// a simple render function to draw the boxes to the canvas
// N.B. function you intend to use as a post-update function must take the following:
//     int {number} frame interpolation amount
//     entities {Entity[]} an array of entities
//     system {System} the system calling this function
function draw(int, entities) {
  // clear canvas every frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // its generally a good idea to bail early if no entities are affected
  if (!entities.length) return;
  // draw each entity
  entities.forEach((entity) => {
    ctx.fillStyle = `rgb(${entity.components.colour.r}, ${entity.components.colour.g}, ${entity.components.colour.b})`;
    ctx.fillRect(
      entity.components.position.x,
      entity.components.position.y,
      entity.components.size.width,
      entity.components.size.height,
    );
  });
}

// turn the mover function into a system
const mover = world.createSystem({
  // the components required in the function
  components: [ position ],
  // the function itself
  update: moveBoxes,
});

// turn the mover function into a system
const drawer = world.createSystem({
  // the components required in the function
  components: [
    colour,
    position,
    size,
  ],
  // the function itself
  postUpdate: draw,
});

// enable the systems
mover.enable();
drawer.enable();

// game loop example
let lastTime = null;
let accumulator = 0;
const tempo = 1/60;
let dt = tempo;

function onTick(time) {
  window.requestAnimationFrame(onTick)
  world.preUpdate();
  if (lastTime !== null) {
    accumulator += (time - lastTime) / 1000;
    while (accumulator > dt) {
      world.update(dt);
      accumulator -= dt;
    }
  }
  lastTime = time;
  world.postUpdate(accumulator / tempo);
}

window.requestAnimationFrame(onTick)
```

See `./demo` for a more interesting working example.

## To-Do Before 1.0.0 release
### General
1. Finalise API
2. Write comprehensive tests
3. Write consistent code documentation throughout
4. Write argument validation for functions requiring user input
5. Ensure high-quality Typescript definitions throughout
### Components
1. Add schemas and schema validation for component properties
2. Ensure Typescript definitions work consistently - current use of "unknown" causing issues for users
### Archetypes
1. Performance improvements - Ensure getting entities by archetype / components is performant

## Acknowledgements
Miski is inspired by [ape-ecs](https://github.com/fritzy/ape-ecs), [bitECS](https://github.com/NateTheGreatt/bitECS), [ECSY](https://github.com/ecsyjs/ecsy), [Geotic](https://github.com/ddmills/geotic), [HECS](https://github.com/gohyperr/hecs), and [classless.md](https://gist.github.com/mpj/17d8d73275bca303e8d2)

## License
&copy; 2021 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.