export function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

export function dXFromAngleAndHypot(angle, hypot) {
  return hypot * Math.cos(toRadians(angle));
}

export function dYFromAngleAndHypot(angle, hypot) {
  return hypot * Math.sin(toRadians(angle));
}

export function toDegrees(radians) {
  return radians * (180 / Math.PI);
}

export function isCollided(square1, square2) {
  return (
    (square1.x + square1.size / 2) >= (square2.x - square2.size / 2) &&
    (square1.x - square1.size / 2) <= (square2.x + square2.size / 2) &&
    (square1.y + square1.size / 2) >= (square2.y - square2.size / 2) &&
    (square1.y - square1.size / 2) <= (square2.y + square2.size / 2)
  )
}
