/*

Simple 2D JavaScript Vector Class

Hacked from evanw's lightgl.js
https://github.com/evanw/lightgl.js/blob/master/src/vector.js

*/

export function createVector(x = 0, y = 0) {
	let _x = x;
  let _y = y;

  return Object.freeze({
    negative: function() {
      _x = -_x;
      _y = -_y;
    },
    add: function(v) {
      if (typeof v === 'object') {
        _x += v.x;
        _y += v.y;
      } else {
        _x += v;
        _y += v;
      }
      return this.value();
    },
    subtract: function(v) {
      if (typeof v === 'object') {
        _x -= v.x;
        _y -= v.y;
      } else {
        _x -= v;
        _y -= v;
      }
      return this.value();
    },
    multiply: function(v) {
      if (typeof v === 'object') {
        _x *= v.x;
        _y *= v.y;
      } else {
        _x *= v;
        _y *= v;
      }
      return this.value();
    },
    divide: function(v) {
      if (typeof v === 'object') {
        if(v.x != 0) _x /= v.x;
        if(v.y != 0) _y /= v.y;
      } else {
        if(v != 0) {
          _x /= v;
          _y /= v;
        }
      }
      return this.value();
    },
    equals: function(v) {
      return _x == v.x && _y == v.y;
    },
    dot: function(v) {
      return _x * v.x + _y * v.y;
    },
    cross: function(v) {
      return _x * v.y - _y * v.x
    },
    length: function() {
      return Math.sqrt(this.dot(this));
    },
    normalize: function() {
      return this.divide(this.length());
    },
    min: function() {
      return Math.min(_x, _y);
    },
    max: function() {
      return Math.max(_x, _y);
    },
    toAngles: function() {
      return -Math.atan2(-_y, _x);
    },
    angleTo: function(a) {
      return Math.acos(this.dot(a) / (this.length() * a.length()));
    },
    toArray: function(n) {
      return [_x, _y].slice(0, n || 2);
    },
    clone: function() {
      return createVector(_x, _y);
    },
    setBoth: function(x, y) {
      if (typeof x === 'object') {
        _x -= x.x;
        _y -= x.y;
      } else {
        _x -= x;
        _y -= y;
      }
    },
    setX: function(x) {
      _x = x;
    },
    setY: function(y) {
      _y = y;
    },
    value: function() {
      return {x: _x, y: _y};
    },
  })
}

export function negateVector(v) {
	return createVector(-v.x, -v.y);
};

export function addVectors(a, b) {
	if (typeof b === 'object') return createVector(a.x + b.x, a.y + b.y);
	else return createVector(a.x + b, a.y + b);
};

export function subtractVectors(a, b) {
	if (typeof b === 'object') return createVector(a.x - b.x, a.y - b.y);
	else return createVector(a.x - b, a.y - b);
};
export function  multiplyVectors(a, b) {
	if (typeof b === 'object') return createVector(a.x * b.x, a.y * b.y);
	else return createVector(a.x * b, a.y * b);
};
export function divideVectors(a, b) {
	if (typeof b === 'object') return createVector(a.x / b.x, a.y / b.y);
	else return createVector(a.x / b, a.y / b);
};
export function equalsVectors(a, b) {
	return a.x == b.x && a.y == b.y;
};
export function dotVectors(a, b) {
	return a.x * b.x + a.y * b.y;
};
export function crossVectors(a, b) {
	return a.x * b.y - a.y * b.x;
};