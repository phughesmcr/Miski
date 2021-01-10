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

// a simple function to draw the box to the canvas
// N.B. function you intend to use as systems must take the following:
//     dt: {number} frame delta time
//     entities {Entity[]} an array of entities
function draw(dt, entities) {
  // clear canvas every frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  entities.forEach((entity) => {
    // modify component properties
    entity.components.colour.r += 1;
    entity.components.colour.b -= 1;
    entity.components.position.x += 0.5,
    entity.components.position.y -= 0.5,
    // draw
    ctx.fillStyle = `rgb(${entity.components.colour.r}, ${entity.components.colour.g}, ${entity.components.colour.b})`;
    ctx.fillRect(
      entity.components.position.x,
      entity.components.position.y,
      entity.components.size.width,
      entity.components.size.height,
    );
  });
}

// turn the draw function into a system
const drawer = world.createSystem({
  // the components required in the function
  components: [
    size,
    colour,
    position,
  ],
  // the function itself
  system: draw,
});

// enable the system
drawer.enable();

// simple game loop
let lastTime = 0;
function update(time) {
  const dt = time - lastTime;
  // call update to run systems every frame
  world.update(dt);
  lastTime = time;
  window.requestAnimationFrame(update);
}
update();
```

See `./test/index.html` for a working example.

## License
&copy; 2021 P. Hughes. All rights reserved.

Miski ECS is released under the MIT license. See `LICENSE` for further details.