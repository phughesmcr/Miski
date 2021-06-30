// from https://github.com/ecsyjs/ecsy/blob/dev/site/examples/canvas/utils.js - MIT license.
export function random(a, b) {
  return Math.random() * (b - a) + a;
}


export function intersection(circleA, circleB) {
  var a, dx, dy, d, h, rx, ry;
  var x2, y2;

  // [position.x, position.y, radius]
  const [apx, apy, ar] = circleA;
  const [bpx, bpy, br] = circleB;

  // dx and dy are the vertical and horizontal distances between the circle centers.
  dx = bpx - apx;
  dy = bpy - apy;

  // Distance between the centers
  d = Math.sqrt(dy * dy + dx * dx);

  // Check for solvability
  if (d > ar + br) {
    // No solution: circles don't intersect
    return false;
  }
  if (d < Math.abs(ar - br)) {
    // No solution: one circle is contained in the other
    return false;
  }

  /* 'point 2' is the point where the line through the circle
   * intersection points crosses the line between the circle
   * centers.
   */

  /* Determine the distance from point 0 to point 2. */
  a =
    (ar * ar -
      br * br +
      d * d) /
    (2.0 * d);

  /* Determine the coordinates of point 2. */
  x2 = apx + (dx * a) / d;
  y2 = apy + (dy * a) / d;

  /* Determine the distance from point 2 to either of the
   * intersection points.
   */
  h = Math.sqrt(ar * ar - a * a);

  /* Now determine the offsets of the intersection points from
   * point 2.
   */
  rx = -dy * (h / d);
  ry = dx * (h / d);

  /* Determine the absolute intersection points. */
  var xi = x2 + rx;
  var xi_prime = x2 - rx;
  var yi = y2 + ry;
  var yi_prime = y2 - ry;

  return [xi, yi, xi_prime, yi_prime];
}

export function fillCircle(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2, false);
  ctx.fill();
}

export function drawLine(ctx, a, b, c, d) {
  ctx.beginPath();
  ctx.moveTo(a, b);
  ctx.lineTo(c, d)
  ctx.stroke();
}
