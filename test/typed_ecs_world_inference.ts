import { createEcsWorld } from "../mod.ts";

const game = createEcsWorld({
  capacity: 16,
  components: {
    Position: { x: Float32Array, y: Float32Array },
    Health: { hp: Uint16Array },
  },
  tags: {
    Player: true,
    Hero: { maxEntities: 1 },
  },
});

const xColumn: Float32Array = game.storage.Position.partitions.x;
const hpColumn: Uint16Array = game.storage.Health.partitions.hp;
const playerPartitions: null = game.storage.Player.partitions;

game.spawn({ Position: { x: 1 }, Health: { hp: 100 }, Player: true });
game.spawn({ Position: { x: 2 }, Hero: true });

// @ts-expect-error Component names come from the schema map.
game.spawn({ Velocity: { x: 1 } });

// @ts-expect-error Component property names come from their schema.
game.spawn({ Position: { z: 1 } });

// @ts-expect-error Tags must be spawned with true, not a payload object.
game.spawn({ Player: { nope: 1 } });

// @ts-expect-error Unknown tags are rejected.
game.spawn({ Enemy: true });

void xColumn;
void hpColumn;
void playerPartitions;
void game.components.Hero;
