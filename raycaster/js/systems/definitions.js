"use strict";

import { createRay } from "../things/rays.js";

/* const eventBuffer = {
  name: "eventbuffer",
  components: ["eventlistener"],
  updateFn: function(dt, entities) {

  },
}; */

const mouseInput = {
  name: "mouseinput",
  components: ["mouseinput"],
  preUpdateFn: function(entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      const buttonMaps = Array.from(entity.components.mouseinput.buttonMap.entries());
      const buttonStates = entity.components.mouseinput.buttonStates;
      const mapLen = buttonMaps.length;
      if (!mapLen) continue;
      for (let j = 0; j < mapLen; j++) {
        const [name, callback] = buttonMaps[j];
        if (buttonStates.has(name)) {
          callback(buttonStates.get(name));
        }
      }
    }
  }
};

const keyboardInput = {
  name: "keyboardinput",
  components: ["keyboardinput"],
  preUpdateFn: function(entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      const keyMaps = Array.from(entity.components.keyboardinput.keyMap.entries());
      const keyStates = entity.components.keyboardinput.keyStates;
      const mapLen = keyMaps.length;
      if (!mapLen) continue;
      for (let j = 0; j < mapLen; j++) {
        const [name, callback] = keyMaps[j];
        if (keyStates.has(name)) {
          callback(keyStates.get(name));
        }
      }
    }
  }
};

const correctHeading = {
  name: "correctheading",
  components: ["heading"],
  preUpdateFn: function(entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      if (entity.components.heading.heading === 0) {
        entity.components.heading.heading = 0.1;
      }
      entity.components.heading.heading = entity.components.heading.heading % 360;
    }
  }
}

const handlePlayer = {
  name: "player",
  components: [
    "player",
    "position",
    "direction",
    "heading",
    "velocity",
    "keyboardinput",
    "mouseinput"
  ],
  preUpdateFn: function(entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      const mouse = entity.components.mouseinput;
    }
  },
  updateFn: function(dt, entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      const dir = entity.components.direction;
      // movement
      if (dir.x === 1) {
        entity.components.position.x += entity.components.velocity.x * dt;
      } else {
        console.log(entity.components.position.x - (entity.components.velocity.x * dt));
        entity.components.position.x -= entity.components.velocity.x * dt;
      }

      if (dir.y === 1) {
        entity.components.position.y += entity.components.velocity.y * dt;
      } else {
        entity.components.position.y -= entity.components.velocity.y * dt;
      }
    }
  },
  renderFn: function(dt, entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      /** @type {CanvasRenderingContext2D} */
      const buffer = entity.world.entity.components.buffer.ctx;
      buffer.save();
      buffer.fillStyle = '#fff';
      buffer.fillRect(entity.components.position.x, entity.components.position.y, 10, 10);
      buffer.restore();
    }
  },
};

const renderBoundaries = {
  name: "renderboundaries",
  components: ["boundary"],
  renderFn: function(int, entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      /** @type {CanvasRenderingContext2D} */
      const buffer = entity.world.entity.components.buffer.ctx;
      const boundary = entity.components.boundary;
      if (!entity || !buffer || !boundary) continue;
      buffer.save();
      buffer.strokeStyle = '#fff';
      buffer.beginPath();
      buffer.moveTo(boundary.start.x, boundary.start.y);
      buffer.lineTo(boundary.end.x, boundary.end.y);
      buffer.stroke();
      buffer.restore();
    }
  },
};

const drawRays = {
  name: "drawRays",
  components: [
    "raycaster",
    "position",
    "direction",
    "heading",
  ],
  preUpdateFn: function(entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      const caster = entity.components.raycaster;

      if (caster.rays.length === 0 || caster.rays.length !== caster.fov) {
        entity.components.raycaster.rays.length = 0;
        for (let i = -caster.fov / 2; i < caster.fov / 2; i++) {
          const a = entity.components.heading.heading + (i * (Math.PI / 180));
          entity.components.raycaster.rays.push(createRay(entity.components.position, a));
        }
      } else {
        let idx = 0;
        for (let i = -caster.fov / 2; i < caster.fov / 2; i++) {
          const a = entity.components.heading.heading + (i * (Math.PI / 180));
          entity.components.raycaster.rays[idx].setPos(entity.components.position);
          entity.components.raycaster.rays[idx].setAngle(a);
          idx++;
        }
      }
    }
  },
  renderFn: function(int, entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      /** @type {CanvasRenderingContext2D} */
      const buffer = entity.world.entity.components.buffer.ctx;
      const pos = entity.components.position;
      const dir = entity.components.direction;
      buffer.save();
      buffer.strokeStyle = "red";
      for (let ray of entity.components.raycaster.rays) {
        buffer.beginPath();
        buffer.moveTo(ray.pos.x, ray.pos.y);
        buffer.lineTo(ray.dir.x * 100, ray.dir.y * 100)
        buffer.stroke();
        buffer.restore();
      }
    }
  }
}

const render = {
  name: "render",
  components: [
    "canvas",
    "buffer",
  ],
  renderFn: function(int, entities) {
    if (!entities.length) return;
    const len = entities.length - 1;
    for (let i = len; i >= 0; i--) {
      /** @type {Entity} */
      const entity = entities[i];
      /** @type {CanvasRenderingContext2D} */
      const ctx = entity.components.canvas.ctx;
      /** @type {CanvasRenderingContext2D} */
      const bufferCtx = entity.components.buffer.ctx;
      const bufferCnv = bufferCtx.canvas;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.drawImage(bufferCnv, 0, 0);
      bufferCtx.clearRect(0, 0, bufferCnv.width, bufferCnv.height);
    }
  },
};

// export order matters!
export const systems = [
  mouseInput,
  keyboardInput,
  correctHeading,
  handlePlayer,
  renderBoundaries,
  drawRays,
  render,
]
