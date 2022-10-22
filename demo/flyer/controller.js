/** @param {World} world */
export const Controller = function(world) {
  const v = world.getComponent(Velocity);
  const h = world.getComponent(Heading);
  /** @type Map<number, boolean> */
  const pressedKeys = new Map();

  const accelerate = (entity) => {
    const { proxy } = v;
    proxy.entity = entity;
    if (proxy.v < maxVelocity) proxy.v += 5;
  }

  const decelerate = (entity) => {
    const { proxy } = v;
    proxy.entity = entity;
    if (proxy.v > minVelocity) proxy.v -= 5;
  }

  const turnLeft = (entity) => {
    const { proxy } = h;
    proxy.entity = entity;
    proxy.h <= 0 ? proxy.h = 359 : proxy.h -= 5;
  }

  const turnRight = (entity) => {
    const { proxy } = h;
    proxy.entity = entity;
    proxy.h >= 360 ? proxy.h = 1 : proxy.h += 5;
  }

  return { accelerate, decelerate, turnLeft, turnRight };
}
