/** @param {World} world */
export const Hero = function(world) {
  const makePlayer = world.addComponentsToEntity(Player);

  const createHero = () => {
    const hero = Ship(world).createShip(canvas.width / 2, canvas.height / 2, 0);
    if (hero !== undefined) makePlayer(hero);
    return hero;
  };

  return { createHero };
}
