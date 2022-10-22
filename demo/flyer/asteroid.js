/** @param {World} world */
export const Asteroid = function(world) {
  const asteroidSizes = [8, 16, 32];
  const asteroidsPerSplit = 3;
  const minVelocity = 5;
  const maxVelocity = 30;

  const factory = world.addComponentsToEntity(Heading, Position, Size, Velocity);

  const createAsteroid = () => {
    const entity = world.createEntity();
    if (entity !== undefined) {
      factory(entity, {
        heading: {
          h: Math.random() * 360,
        },
        position: {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
        },
        size: {
          s: asteroidSizes[Math.floor(Math.random() * asteroidSizes.length)]
        },
        velocity: {
          v: minVelocity + (Math.random() * (maxVelocity - minVelocity))
        },
      });
    }
    return entity;
  };

  const rocketHit = (rocket, asteroid) => {
    if (asteroid.size > this.asteroidSizes[0]) {
        for (let i = 0; i < this.asteroidsPerSplit; i++) {
            this.asteroids.push(new Asteroid(asteroid.x, asteroid.y, Math.random() * 360, asteroid.velocity, asteroid.size / 2));
        }
    }
    asteroid.size = 0;
    rocket.age = game.ship.maxRocketAge;
    this.asteroids = this.asteroids.filter(asteroid => asteroid.size > 0);
  }

  /** @returns {System} */
  const updateAsteroids = (components, entities, game) => {

  };

  /** @returns {System} */
  const renderAsteroids = (components, entities) => {
    const { position, size } = components;
    const { x, y } = position;
    const { s } = size;
    ctx.save();
    ctx.fillStyle = "#fff";
    for (const entity of entities) {
      const fullS = s[entity];
      const halfS = fullS / 2;
      const leftX = x[entity] - halfS;
      const topY = y[entity] - halfS;
      ctx.fillRect(leftX, topY, fullS, fullS);
    }
    ctx.restore();
  }

  return { createAsteroid, renderAsteroids, updateAsteroids };
};
