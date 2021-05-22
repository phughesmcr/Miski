"use strict";

import { createVec, createVecFromAngle } from '../utils.js';

export function createRay(pos, angle) {
  return {
    pos: createVec(pos.x, pos.y, pos.z),
    dir: createVecFromAngle(angle),
    pt: null,
    setAngle: function(rad) {
      this.dir = createVecFromAngle(angle)
    },
    setPos: function(pos) {
      this.pos = pos;
    },
    lookAt: function(x, y) {
      this.dir.x = x - this.pos.x;
      this.dir.y = y - this.pos.y;
      this.dir.normalize();
    },
    cast: function(boundary) {
      const x1 = boundary.start.x;
      const y1 = boundary.start.y;
      const x2 = boundary.end.x;
      const y2 = boundary.end.y;

      const x3 = this.pos.x;
      const y3 = this.pos.y;
      const x4 = this.pos.x + this.dir.x;
      const y4 = this.pos.y + this.dir.y;

      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (den !== 0) {
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
        if (t > 0 && t < 1 && u > 0) {
          this.pt = createVec(x1 + t * (x2 - x1), y1 + t * (y2 - y1), 0);
        } else {
          this.pt = null
        }
      } else {
        this.pt = null;
      }
    },
  };
}