"use strict";

import { createVec, dist } from "../utils";

const canvas = {
  name: 'canvas',
  entityLimit: 1,
  removable: false,
  properties: {
    ctx: null,
  }
};

const bufferable = {
  name: "bufferable",
  properties: {
    buffered: false,
    dirty: true,
  }
}

const buffer = {
  name: 'buffer',
  entityLimit: 1,
  removable: false,
  properties: {
    ctx: null,
  },
};

const size = {
  name: "size",
  properties: {
    w: 0,
    h: 0,
    d: 0,
  },
};

const velocity = {
  name: "velocity",
  properties: {
    x: 0,
    y: 0,
    z: 0
  },
};

const direction = {
  name: "direction",
  properties: {
    x: 0,
    y: 0,
    z: 0
  },
};

const heading = {
  name: "heading",
  properties: {
    heading: 0,
  },
};

const boundary = {
  name: "boundary",
  properties: {
    start: {
      x: 0,
      y: 0,
      z: 0,
    },
    end: {
      x: 0,
      y: 0,
      z: 0,
    },
  },
};

const raycaster = {
  name: "raycaster",
  properties: {
    fov: 60,
    pos: createVec(),
    rays: [],
    heading: 0;
    closest: [],
    look: function(boundaries) {
      this.closest.length = 0;
      for (let i = 0; i < this.rays.length; i++) {
        const ray = this.rays[i];
        let closest = null;
        let record = Number.POSITIVE_INFINITY;
        for (let boundary of boundaries) {
          ray.cast(boundary);
          if (ray.pt) {
            const d = dist(this.pos, pt);
            if (d < record) {
              record = d;
              closest = ray.pt;
            }
          }
        }
        if (closest) {
          this.closest.push(closest);
        }
      }
    },
  },
};

const player = {
  name: "player",
  properties: {
    isPlayer: true,
  }
};

const keyboardInput = {
  name: "keyboardinput",
  properties: {
    keyStates: new Map(),
    keyMap: new Map(),
    addMapping: function(keyCode, callback) {
      this.keyMap.set(keyCode, callback);
    },
    handleEvent: function(evt) {
      const { keyCode } = evt;
      if (!this.keyMap.has(keyCode)) {
        return void 0;
      }
      event.preventDefault();

      const keyState = evt.type === 'keydown' ? 1 : 0;

      if (this.keyStates.get(keyCode) === keyState) {
        return void 0;
      }

      this.keyStates.set(keyCode, keyState);
      this.keyMap.get(keyCode)(keyState);
    },
    listenTo: function(window) {
      window.addEventListener('keydown', (evt) => {
        this.handleEvent(evt);
      });
      window.addEventListener('keyup', (evt) => {
        this.handleEvent(evt);
      });
    },
  },
};

const mouseInput = {
  name: "mouseinput",
  properties: {
    x: 0,
    y: 0,
    mX: 0,
    mY: 0,
    buttons: 0,
    keyStates: new Map(),
    keyMap: new Map(),
    addMapping: function(button, callback) {
      this.keyMap.set(button, callback);
    },
    handleEvent: function(evt) {
      const { button, type } = evt;

      if (type === 'mousemove') {
        this.x = evt.offsetX;
        this.y = evt.offsetY;
        this.mX = evt.movementX;
        this.mY = evt.movementY;

        if (!this.keyMap.has("mousemove")) {
          return void 0;
        }

        event.preventDefault();
        this.keyMap.get("mousemove")({x: this.x, y: this.y, mX: this.mX, mY: this.mY});
      } else {
        if (!this.keyMap.has(button)) {
          return void 0;
        }
        event.preventDefault();

        const keyState = evt.type === 'mousedown' ? 1 : 0;

        if (this.keyStates.get(button) === keyState) {
          return void 0;
        }

        this.keyStates.set(button, keyState);
        this.keyMap.get(button)(keyState);
      }

    },
    listenTo: function(window) {
      window.addEventListener('mousemove', (evt) => {
        this.handleEvent(evt);
      }, false);
      window.addEventListener('mousedown', (evt) => {
        this.handleEvent(evt);
      }, false);
      window.addEventListener('mouseup', (evt) => {
        this.handleEvent(evt);
      }, false);
    },
  },
};

export const components = {
  canvas,
  buffer,
  bufferable,
  position,
  size,
  velocity,
  direction,
  heading,
  boundary,
  raycaster,
  ray,
  player,
  keyboardInput,
  mouseInput,
};