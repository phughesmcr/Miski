import { compileComponentSchema, createEcsWorld, type Entity, type Relation } from "../mod.ts";

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

const maybe: Entity | undefined = game.spawn({ Player: true });
const sure: Entity = game.spawnOrThrow({ Player: true });
// @ts-expect-error Plain spawn returns undefined at capacity.
const notSure: Entity = game.spawn({ Player: true });

// A precompiled schema infers the same maps, and relations still infer beside it.
const schema = compileComponentSchema({ Position: { x: Float32Array, y: Float32Array } }, { Player: true });
const fromSchema = createEcsWorld({
  capacity: 8,
  schema,
  relations: { ChildOf: { exclusive: true }, Likes: { schema: { weight: Float32Array } } },
});
const schemaX: Float32Array = fromSchema.storage.Position.partitions.x;
const childOf: Relation<null> = fromSchema.relations.ChildOf;
const likes: Relation<{ weight: Float32ArrayConstructor }> = fromSchema.relations.Likes;
fromSchema.spawn({ Position: { x: 1 }, Player: true });
// @ts-expect-error Component names come from the compiled schema.
fromSchema.spawn({ Velocity: { x: 1 } });
// @ts-expect-error A config takes either a schema or inline components, not both.
createEcsWorld({ capacity: 8, schema, components: { Position: { x: Float32Array } } });

void [maybe, sure, notSure, schemaX, childOf, likes];
void xColumn;
void hpColumn;
void playerPartitions;
void game.components.Hero;
