# Ⓜ Miski ECS

*__Miski__: Quechuan adjective meaning "sweet"*.

*__Miski ECS__: A sweet ECS architecture written in Typescript.*

Miski is currently in alpha. Expect breaking changes every version until beta.

## Install

`CJS`, `ESM`, `IIFE` and `UMD` builds are available in the `./dist` folder.

Miski requires `BigInt` support.

## Usage

A simple box on a 2d canvas example:

```javascript
import { createWorld } from "../dist/esm/index.min.js";
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

// create our world - most functions take place through the world object
const world = createWorld({
  initialPoolSize: 10,
  maxComponents: 1024,
});

// define some components - the properties given here are the default properties of the component
const size = world.createComponent({
  name: "size",
  properties: {
    height: 100,
    width: 100,
  },
});

const colour = world.createComponent({
  name: "colour",
  properties: {
    r: 0,
    g: 0,
    b: 0,
  },
});

const position = world.createComponent({
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
// N.B. you can access the individual properties of course (e.g. box.components.colour.r)
box.components.colour = { r: 150, g: 150, b: 150 };
box.components.position = { x: 100, y: 250 };

// world systems support two functions
// 1) an update function - (updateFn) - to potentially be called multiple times per frame
// 2) a render (or post-update) function - (renderFn) - to be called only once per frame
// you must supply at least one of these functions per system, or both

// a simple update function to move boxes around the canvas
// N.B. update functions you intend to use as systems must take the following:
//     dt: {number} frame delta time
//     entities {Entity[]} an array of entities
function moveBoxes(dt, entites) {
  entities.forEach((entity) => {
    // modify component properties
    entity.components.position.x += (0.5 * dt),
    entity.components.position.y -= (0.5 * dt),
  }
}

// a simple render (or post-update) function to draw the boxes to the canvas
// N.B. function you intend to use as systems must take the following:
//     int: {number} frame interpolation amount
//     entities {Entity[]} an array of entities
function draw(dt, entities) {
  // clear canvas every frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  components: [
    position,
  ],
  // the function itself
  updateFn: moveBoxes,
  // you could add a renderFn here too if you wanted to
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
  rendereFn: draw,
  // you could add an updateFn here too if you wanted to
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
  if (lastTime !== null) {
    accumulator += (time - lastTime) / 1000;
    while (accumulator > dt) {
      world.update(dt); // all updateFns called here
      accumulator -= dt;
    }
  }
  lastTime = time;
  world.render(accumulator / tempo); // all renderFns called here
}

window.requestAnimationFrame(onTick)
```

See `./demo` for a more interesting working example.

## License
&copy; 2021 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.