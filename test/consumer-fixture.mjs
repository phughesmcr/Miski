// deno-lint-ignore-file explicit-function-return-type explicit-module-boundary-types -- plain JavaScript run by scripts/consumer-smoke.ts; it cannot carry type annotations
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** The same public gameplay contract runs in Node, Bun, and Chromium. */
export async function runConsumerSmoke({ createEcsWorld, World }, expectedVersion) {
  assert(World.version === expectedVersion, `Expected ${expectedVersion}, received ${World.version}`);
  const game = createEcsWorld({
    capacity: 8,
    components: { Position: { x: Float32Array, y: Float32Array } },
    tags: { Player: true },
  });
  await game.init();
  try {
    const entity = game.spawnOrThrow({ Position: { x: 1 }, Player: true });
    const position = game.storage.Position;
    assert(position.get(entity, "y") === 0, "Omitted fields must start at zero");
    position.set(entity, "x", 2);
    assert(position.get(entity, "x") === 2, "Guarded writes must reach the owner");
    const query = game.query(game.components.Position, game.components.Player);
    const snapshot = game.world.entities.querySnapshot(query);
    assert(snapshot.length === 1 && snapshot[0] === entity, "Queries must return the spawned handle");
    game.world.entities.destroy(entity);
    assert(!game.world.entities.isActive(entity), "Destroyed handles must be inactive");
    assert(game.world.entities.querySnapshot(query).length === 0, "Destroyed entities must leave queries");
    assert(snapshot[0] === entity, "Snapshots must survive later mutations");
    const replacement = game.spawnOrThrow({ Position: { x: 3 } });
    assert(replacement !== entity && position.get(replacement, "x") === 3, "Recycled slots must get new handles");
    return { version: World.version };
  } finally {
    await game.world.destroy();
  }
}
