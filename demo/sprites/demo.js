/**
 * Based on ECSY's "circles and boxes" demo.
 * @see https://github.com/ecsyjs/ecsy/blob/master/site/examples/circles-boxes/index.html
 *
 * This code is very verbose,
 * the purpose is not to show efficient Miski code,
 * but understandable Miski code.
 */
import { Component, Query, System, World } from "../../dist/miski.min.js";

(function() {
  /**
   * 0. Setup
   */

  const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
  });

  const Config = {
    box: {
      fill: "#f28d89",
      stroke: "white",
    },
    canvas: {
      img: "bg.png",
    },
    circle: {
      fill: "#8cb6f6",
      stroke: "white",
    },
    shape: {
      size: 20,
      halfSize: 10,
    },
    sprites: {
      img: "sprites.png",
      width: 16,
      height: 16,
      rows: 8,
      cols: 8,
    },
    star: {
      fill: "yellow",
      stroke: "white",
    },
    simulation: {
      speed: 0.1,
    },
    world: {
      capacity: params.capacity ? parseInt(params.capacity, 10) : 5000,
      initElements: params.init ? parseInt(params.init, 10) : 600,
    }
  };

  const State = {
    entities: [],
    numElements: 0,
  };

  const Utils = {
    /**
     * Get correct mouse position on Canvas element
     * @param {MouseEvent} event
     */
    getMousePosition: (event) => {
      const { left, top } = canvas.getBoundingClientRect();
      return {
        mx: (event.clientX - left),
        my: (event.clientY - top),
      };
    },
    getRandomPosition: (w, h) => ({ x: Math.random() * w, y: Math.random() * h }),
    getRandomShape: () => ({ primitive: Math.random() >= 0.5 ? 1 : 0 }), // 0 = box, 1 = circle
    getRandomVelocity: () => ({ vx: Utils.rnd(-2, 2), vy: Utils.rnd(-2, 2) }),
    intersectRect: (x1, y1, x2, y2) => !(x2 > x1 + Config.shape.size || x2 + Config.shape.size < x1 || y2 > y1 + Config.shape.size || y2 + Config.shape.size < y1),
    resizeCanvas: (canvas, ctx, offscreenCanvas) => {
      const { devicePixelRatio = 1 } = window;
      const { clientHeight, clientWidth } = document.documentElement;
      const scale = params.scale ? parseInt(params.scale, 10) : devicePixelRatio;
      const width = params.width ? parseInt(params.width, 10) : clientWidth;
      const height = params.height ? parseInt(params.height, 10) : clientHeight;
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.scale(scale, scale);
    },
    rnd: (a, b) => Math.random() * (b - a) + a,
  };

  // Canvas
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.style.imageRendering = "pixelated";
  ctx.imageSmoothingEnabled = false;

  // Offscreen canvas (not strictly necessary)
  const offscreenCanvas = document.createElement('canvas');
  const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
  offscreenCanvas.style.imageRendering = "pixelated";
  offscreenCtx.imageSmoothingEnabled = false;

  /**
   * 1. Define components
   *
   * - Components are reusable data storage definitions.
   * - They consist of a name (must be unique), and an optional storage schema.
   * - A storage schema is an object where the key is a string and the value is a TypedArrayConstructor.
   * - Components without schemas are "tags". As such, a tag has no properties.
   * - Tags can be included in queries just like a regular component.
   * - Tags and components can be tested for using `world.entityHasComponent(entity, component)`.
   */
  const Components = {
    // Regular components:
    position: new Component({ name: "position", schema: { x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array }}),
    shape: new Component({ name: "shape", schema: { primitive: Uint8Array }}),
    velocity: new Component({ name: "velocity", schema: { vx: Float32Array, vy: Float32Array }}),
    // Tag component:
    clicked: new Component({ name: "clicked" }),
  };

  /**
   * 2. Create queries
   *
   * Queries group objects by components for use in systems
   * Queries can take 3 arrays of components: `all` (AND), `any` (OR), `none` (NOT).
   * You can get the result of a query inside a system by calling `world.getQueryResult(query)`.
   * getQueryResult returns an tuple (array) of [Record<string, ComponentInstance, Entity[]]
   * I recommend you destructure it as:
   * `const [components, entities] = world.getQueryResult(query);`
   * Note: the entities array is essentially in a random order (by archetype id) so you may want to sort it yourself.
   */
  const Queries = {
    movable: new Query({ all: [Components.position, Components.velocity] }),
    renderable: new Query({ all: [Components.position, Components.shape] }),
  };

  /**
   * 3. Create a world
   *
   * To create a world you need two things:
   *  i. capacity: the maximum number of entities you want to allow in the world
   * ii. components: an array of components to register in the world
   *
   * NOTE: Components cannot be registered after the world has been created.
   */
  const world = new World({
    capacity: Config.world.capacity,
    components: [...Object.values(Components)],
  });

  // Expose the world object for debugging (don't do this in production!)
  window.world = world;

  /**
   * 4. Define Systems
   *
   * Systems are functions of any arity where the first two (2) parameters are always:
   *  i: an object containing the components captured by the system's query/ies (Record<string, ComponentInstance>).
   * ii: an IterableIterator of entities currently captured by the system's query/ies (IterableIterator<Entity>).
   *
   * For example: `function(component, entities) {...}` or `function(component, entities, ...args)`, etc.
   * Defining systems using `createSystem` isn't necessary but doing so ensures type safety and some caching.
   * Systems created using `createSystem` will return whatever your function returns (i.e., ReturnType<T>).
   */

  // First, let's define our sprite sheet
  const img = new Image();
  let imgLoaded = false;
  img.crossOrigin = 'anonymous';
  img.style.imageRendering = "pixelated";
  img.imageSmoothingEnabled = false;
  img.addEventListener("load", () => { imgLoaded = true; });
  img.src = Config.sprites.img;

  const drawSprite = (n, x, y, scale = 2) => {
    const sx = Math.floor(n / Config.sprites.rows) * Config.sprites.width;
    const sy = Math.floor(n % Config.sprites.cols) * Config.sprites.height;
    offscreenCtx.drawImage(img, sx, sy, Config.sprites.width, Config.sprites.height, x, y, Config.sprites.width * scale, Config.sprites.height * scale);
  };

  // Second, we'll define our background image
  const bgImg = new Image();
  let bgImgLoaded = false;
  bgImg.crossOrigin = 'anonymous'
  bgImg.style.imageRendering = "pixelated";
  bgImg.imageSmoothingEnabled = false;
  bgImg.addEventListener("load", () => { bgImgLoaded = true; });
  bgImg.src = Config.canvas.img;

  // Next, lets define our callbacks
  // Miski will provide `components` and `entities`
  // You must supply any additional arguments (no further arguments are required.)
  const SystemCbs = {
    move: (components, entities, delta) => {
      const { width, height } = canvas;
      const { position, velocity } = components;
      const { x, y, px, py } = position;
      const { vx, vy } = velocity;
      const HALF_SIZE = Config.shape.halfSize;
      const SPEED = Config.simulation.speed;
      for (const entity of entities) {
        x[entity] += vx[entity] * delta * SPEED;
        y[entity] += vy[entity] * delta * SPEED;
        if (x[entity] > width + HALF_SIZE) {
          x[entity] = -HALF_SIZE;
        } else if (x[entity] < -HALF_SIZE) {
          x[entity] = width + HALF_SIZE;
        }
        if (y[entity] > height + HALF_SIZE) {
          y[entity] = -HALF_SIZE;
        } else if (y[entity] < -HALF_SIZE) {
          y[entity] = height + HALF_SIZE;
        }
        px[entity] = x[entity];
        py[entity] = y[entity];
      }
    },
    render: (components, entities, alpha) => {
      const { position, shape } = components;
      const { x, y, px, py } = position;
      const { primitive } = shape;
      // Clear canvas
      const size = Math.max(offscreenCanvas.width, offscreenCanvas.height, 1024);
      offscreenCtx.drawImage(bgImg, 0, 0, 1024, 1024, 0, 0, size, size);
      // Draw entities
      for (const entity of entities) {
        drawSprite(
          primitive[entity],
          (x[entity] - px[entity]) * alpha + px[entity],
          (y[entity] - py[entity]) * alpha + py[entity]
        );
      }
      ctx.drawImage(offscreenCanvas, 0, 0);
    },
  }

  // Next, we'll define our actual Systems.
  // Calling .init(world) returns the system callback function
  const Systems = {
    move: new System({ query: Queries.movable, system: SystemCbs.move }).init(world),
    render: new System({ query: Queries.renderable, system: SystemCbs.render }).init(world),
  };


  /**
   * 5. Create Entities and give them some components
   */

  // You can define a prefab factory like so:
  const shapeBuilder = world.addComponentsToEntity(
    Components.velocity,
    Components.position,
    Components.shape
  );

  const createShapes = (n, w = canvas.width, h = canvas.height) => {
    for (let i = 0; i < n; i++) {
      const entity = world.createEntity(); // this is the only Miski specific bit
      if (entity !== undefined) {
        shapeBuilder(entity, {
          position: Utils.getRandomPosition(w, h),
          shape: { primitive: Utils.rnd(1, Config.sprites.rows * Config.sprites.cols - 1) },
          velocity: Utils.getRandomVelocity(),
        });
        State.entities.push(entity);
      }
    }
  };

  const destroyShapes = (n) => {
    for (let i = 0; i < n; i++) {
      const e = State.entities.pop();
      if (e !== undefined) {
        world.destroyEntity(e);  // this is the only Miski specific bit
      }
    }
  };

  window.addEventListener("load", () => {
    // DOM elements
    const spanEntities = document.getElementById("sEnts");
    const spanResX = document.getElementById("sResX");
    const spanResY = document.getElementById("sResY");
    const rangeSpeed = document.getElementById("rSpeed");
    const btnAdd = document.getElementById("add");
    const btnSub = document.getElementById("subtract");
    const btnAddBig = document.getElementById("addBig");
    const btnSubBig = document.getElementById("subtractBig");
    const btnRender = document.getElementById("bRender");

    const updateEntityCount = () => spanEntities.textContent = State.entities.length.toString();
    const updateResolutionSpans = () => { spanResX.textContent = canvas.width.toString(); spanResY.textContent = canvas.height.toString() };

    // Entity add/remove buttons
    btnAdd.addEventListener("click", () => { createShapes(10); updateEntityCount(); }, { passive: true });
    btnSub.addEventListener("click", () => { destroyShapes(10); updateEntityCount(); }, { passive: true });
    btnAddBig.addEventListener("click", () => { createShapes(100); updateEntityCount(); }, { passive: true });
    btnSubBig.addEventListener("click", () => { destroyShapes(100); updateEntityCount(); }, { passive: true });

    // Simulation speed slider
    rangeSpeed.addEventListener("input", () => { Config.simulation.speed = rSpeed.value; }, { passive: true });
    Config.simulation.speed = rangeSpeed.value;

    // Conveniences for mousedown event listener below
    const addClickedTag = world.addComponentsToEntity(Components.clicked);
    const getRenderableEntities = world.getQueryEntities(Queries.renderable);
    const { position, shape } = world.getQueryComponents(Queries.renderable);
    const { x, y } = position;
    const { primitive } = shape;

    // Listen for clicking on entities
    canvas.addEventListener("mousedown", (event) => {
      const SHAPE_SIZE = Config.shape.size;
      const { mx, my } = Utils.getMousePosition(event);
      /** @todo this seems a tad ridiculous */
      for (const entity of getRenderableEntities()) {
        if (Utils.intersectRect(mx, my, x[entity], y[entity], SHAPE_SIZE)) {
          primitive[entity] = 0;
          addClickedTag(entity);
          console.log("clicked on entity " + entity);
          break;
        }
      }
    }, { passive: true });

    // Game loop
    const fps = 60;
    const frameDuration = 1000 / fps;
    let lag = 0;
    let previous;

    const start = (time) => {
      requestAnimationFrame(start);
      let delta = time - previous;
      if (delta > 240) delta = frameDuration;
      lag += delta;
      while (lag >= frameDuration) {
        // call your systems just like regular functions
        Systems.move(frameDuration);
        lag -= frameDuration;
      }
      if (btnRender.checked && bgImgLoaded && imgLoaded) Systems.render(lag / frameDuration);
      // runs World maintenance functions
      // I recommend calling this once per frame
      world.refresh();
      previous = time;
    };

    // Init canvas
    Utils.resizeCanvas(canvas, ctx, offscreenCanvas);
    updateResolutionSpans();
    window.addEventListener("resize", () => {
      Utils.resizeCanvas(canvas, ctx, offscreenCanvas);
      updateResolutionSpans();
    }, { passive: true });

    // Init entities
    createShapes(Config.world.initElements);
    updateEntityCount();

    // Begin
    previous = performance?.now() || Date.now();
    requestAnimationFrame(start);
  }, { passive: true, once: true });
})();
