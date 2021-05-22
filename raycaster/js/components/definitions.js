"use strict";

import { createVec } from "../utils.js";

const position = {
  name: "position",
  properties: createVec(),
};

const direction = {
  name: "direction",
  properties: createVec(1, 1, 1),
};

const velocity = {
  name: "velocity",
  properties: createVec(),
};

const heading = {
  name: "heading",
  properties: {
    heading: 360,
  },
};

const boundary = {
  name: "boundary",
  properties: {
    start: createVec(),
    end: createVec(),
  },
};

const player = {
  name: "player",
  entityLimit: 1,
  properties: {
    isPlayer: true,
  },
};

const canvas = {
  name: "canvas",
  properties: {
    ctx: null,
    canvas: {
      get: function() {
        return this.ctx?.canvas;
      }
    },
  },
};

const buffer = {
  name: "buffer",
  properties: {
    ctx: null,
    canvas: {
      get: function() {
        return this.ctx?.canvas;
      }
    },
  },
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
      // this should go in system
      // this.keyMap.get(keyCode)(keyState);
      return void 0;
    },
    listenTo: function(window) {
      window.addEventListener('keydown', (evt) => {
        this.handleEvent(evt);
      }, false);
      window.addEventListener('keyup', (evt) => {
        this.handleEvent(evt);
      }, false);
    }
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
    buttonStates: new Map(),
    buttonMap: new Map(),
    addMapping: function(button, callback) {
      this.buttonMap.set(button, callback);
    },
    handleEvent: function(evt) {
      const { button, type } = evt;
      if (type === 'mousemove') {
        this.x = evt.offsetX;
        this.y = evt.offsetY;
        this.mX = evt.movementX;
        this.mY = evt.movementY;
        if (!this.buttonMap.has("mousemove")) {
          return void 0;
        }
        event.preventDefault();
      } else {
        if (!this.buttonMap.has(button)) {
          return void 0;
        }
        event.preventDefault();
        const keyState = evt.type === 'mousedown' ? 1 : 0;
        if (this.buttonStates.get(button) === keyState) {
          return void 0;
        }
        this.buttonStates.set(button, keyState);
        return void 0;
      }
      return void 0;
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
    }
  },
};

const rayCaster = {
  name: "raycaster",
  properties: {
    fov: 60,
    rays: [],
  },
};

const eventBuffer = {
  name: "eventbuffer",
  properties: {
    events: [], // name, args
    emit: function(name, args) {
      this.events.push({name, args});
    },
    process: function(name, callback) {
      this.events.forEach((evt) => {
        if (evt.name === name) {
          callback(...evt.args);
        }
      });
    },
  }
};

const eventListener = {
  name: "eventlistener",
  properties: {
    listeners: [],
    listen: function(name, callback) {
      this.listeners.push({name, callback});
    },
  }
};

export const components = [
  boundary,
  buffer,
  canvas,
  direction,
  eventBuffer,
  eventListener,
  heading,
  keyboardInput,
  mouseInput,
  player,
  position,
  rayCaster,
  velocity,
]