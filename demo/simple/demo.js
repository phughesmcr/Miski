import {
  createWorld,
  createComponent,
  createEntity,
  registerComponent,
  addComponentToEntity,
  createQuery,
  createSystem,
  enableSystem,
  registerSystem,
  runPreSystems,
  runPostSystems,
  runUpdateSystems,
  ui32,
  f32,
  ui8,
} from '../miski.min.js';

(async () => {
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
        r[entity] += 1;
        g[entity] += 1;
        b[entity] += 1;

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
})();
