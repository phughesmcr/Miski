"use strict";


// random function
export function rnd(min, max) { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/** Get distance between 2 vectors */
export function dist(start, end) {
  const a = start.x - end.x;
  const b = start.y - end.y;
  return Math.sqrt(a * a + b * b);
}

/** Create a vector object */
export function createVec(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    normalize: function() {
      const sq = Math.sqrt(this.x * this.x + this.y * this.y);
      if (sq !== 0) {
        const len = (1/ sq);
        this.x *= len;
        this.y *= len;
      }
    },
    fromAngle: function(angle, length = 1) {
      this.x = length * Math.cos(angle);
      this.y = length * Math.sin(angle);
    },
  }
};

export function createVecFromAngle(angle, length = 1) {
  return {
    x: length * Math.cos(angle),
    y: length * Math.sin(angle),
    z: 0,
  }
}

/** Convert angles to radians */
export function angleToRad(angle) {
  return (angle * (Math.PI / 180));
}

