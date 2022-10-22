/** @param {World} world */
export const Ship = function(world) {
  const maxRockets = 10;
  const maxRocketAge = 5;
  const maxVelocity = 50;
  const minVelocity = -25;

  const factory = world.addComponentsToEntity(Heading, Position, Size, Velocity);

  const createShip = (x, y, heading) => {
    const entity = world.createEntity();
    if (entity !== undefined) {
      factory(entity, {
        heading: {
          h: heading,
        },
        position: {
          x,
          y,
        },
        size: {
          s: 20,
        },
        velocity: {
          v: 0,
        },
      });
    }
    return entity;
  };

  const renderShip = (components, entities) => {
    const { heading, position, size } = components;
    const { h } = heading;
    const { x, y } = position;
    const { s } = size;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#77ffff';
    for (const entity of entities) {
      const _heading = h[entity];
      const _size = s[entity];
      const halfSize = _size / 2;
      const tipX = x[entity] + dXFromAngleAndHypot(_heading, halfSize);
      const tipY = y[entity] + dYFromAngleAndHypot(_heading, halfSize);
      const opposite = _heading <= 180 ? _heading + 180 : _heading - 180;
      ctx.beginPath();
      ctx.arc(
        tipX,
        tipY,
        s[entity],
        toRadians(opposite - 22.5),
        toRadians(opposite + 22.5)
      );
      ctx.lineTo(tipX, tipY);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  };

  return { createShip };
};
