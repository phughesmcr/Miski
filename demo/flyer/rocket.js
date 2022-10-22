/** @param {World} world */
export const Rocket = function(world) {
  const factory = world.addComponentsToEntity(Heading, PlayerMissile, Position, Size, Velocity);

  const createRocket = (x, y, heading) => {
    const entity = world.createEntity();
    if (entity !== undefined) {
      factory(entity, {
        heading: {
          h: heading,
        },
        playerMissile: {
          age: 0, // not strictly necessary since properties are initialized at 0 anyway
        },
        position: {
          x,
          y,
        },
        size: {
          s: 2,
        },
        velocity: {
          v: 75,
        },
      });
    }
    return entity;
  };

  /** @type {SystemCallback} */
  const renderRocket = (components, entities) => {
    const { position, size } = components;
    const { x, y } = position;
    const { s } = size;
    ctx.save();
    ctx.fillStyle = '#ff0000';
    for (const entity of entities) {
      ctx.fillRect(x[entity], y[entity], s[entity], s[entity]);
    }
    ctx.restore();
  }

  return { createRocket, renderRocket };
};
