// Compile-only checks for prefab typing (type-checked by `deno task check`, never executed).

import { Component, createEcsWorld, defineComponentSchema, Prefab } from "../mod.ts";
import type { BorrowedEntityList, Entity, World } from "../mod.ts";

const Position = new Component({
  name: "position",
  schema: defineComponentSchema({ x: Float32Array, y: Float32Array }),
});
const Marker = new Component({ name: "marker" });

const base = new Prefab({ name: "base", components: [[Position, { x: 1 }], [Marker]] });
const child: Prefab = new Prefab({ extends: base, components: [[Position, { y: 2 }]] });

// @ts-expect-error - unknown data field
new Prefab({ components: [[Position, { z: 1 }]] });
// @ts-expect-error - tags take no data
new Prefab({ components: [[Marker, { x: 1 }]] });
// @ts-expect-error - extends must be a Prefab
new Prefab({ extends: {}, components: [] });

declare const world: World;
const one: Entity | undefined = world.entities.instantiate(child);
const sure: Entity = world.entities.instantiateOrThrow(child, [[Position, { x: 3 }], [Marker]]);
const many: BorrowedEntityList | undefined = world.entities.instantiateMany(base, 4, [[Position, { y: 1 }]]);
const manySure: BorrowedEntityList = world.entities.instantiateManyOrThrow(base, 4);
// @ts-expect-error - unknown override field
world.entities.instantiate(base, [[Position, { z: 1 }]]);

const game = createEcsWorld({
  capacity: 8,
  components: { Position: { x: Float32Array, y: Float32Array } },
  tags: { Enemy: true },
});
const orc: Prefab = game.prefab({ Position: { x: 1 }, Enemy: true }, { name: "orc", extends: base });
const spawned: Entity = game.instantiateOrThrow(orc, { Position: { y: 2 } });
const bulk: BorrowedEntityList = game.instantiateManyOrThrow(orc, 2, { Enemy: true });
const maybeSpawned: Entity | undefined = game.instantiate(orc);
const maybeBulk: BorrowedEntityList | undefined = game.instantiateMany(orc, 2);
// @ts-expect-error - plain instantiate may return undefined at capacity
const notSure: Entity = game.instantiate(orc);
// @ts-expect-error - unknown named field
game.prefab({ Position: { z: 1 } });
// @ts-expect-error - tags take `true`
game.instantiate(orc, { Enemy: false });

void [one, sure, many, manySure, spawned, bulk, maybeSpawned, maybeBulk, notSure];
