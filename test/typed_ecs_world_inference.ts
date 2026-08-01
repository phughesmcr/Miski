import { createEcsWorld } from "../mod.ts";

const game = createEcsWorld({
  capacity: 16,
  components: {
    Position: { x: Float32Array, y: Float32Array },
    Health: { hp: Uint16Array },
  },
});

const xColumn: Float32Array = game.storage.Position.partitions.x;
const hpColumn: Uint16Array = game.storage.Health.partitions.hp;

game.spawn({ Position: { x: 1 }, Health: { hp: 100 } });

// @ts-expect-error Component names come from the schema map.
game.spawn({ Velocity: { x: 1 } });

// @ts-expect-error Component property names come from their schema.
game.spawn({ Position: { z: 1 } });

void xColumn;
void hpColumn;
