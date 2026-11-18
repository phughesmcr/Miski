// Compile-only checks for field-type inference. Type-checked by `deno task check`, never executed.
import {
  Component,
  type ComponentData,
  type ComponentSchema,
  type ComponentValue,
  createEcsWorld,
  defineComponentSchema,
  type Entity,
  field,
  World,
} from "../mod.ts";

class Mesh {
  readonly kind = "mesh";
}

const unitSchema = defineComponentSchema({
  hp: Uint16Array,
  alive: field.bool(),
  state: field.enum(["idle", "run", "dead"]),
  target: field.entity(),
  label: field.string(),
  mesh: field.object<Mesh>(),
});
type UnitSchema = ComponentSchema<typeof unitSchema>;

type Exact<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
function expectType<T extends true>(_value?: T): void {}

expectType<Exact<ComponentValue<UnitSchema>["hp"], number>>();
expectType<Exact<ComponentValue<UnitSchema>["alive"], boolean>>();
expectType<Exact<ComponentValue<UnitSchema>["state"], "idle" | "run" | "dead">>();
expectType<Exact<ComponentValue<UnitSchema>["target"], Entity | null>>();
expectType<Exact<ComponentValue<UnitSchema>["label"], string>>();
expectType<Exact<ComponentValue<UnitSchema>["mesh"], Mesh | null>>();
expectType<Exact<ComponentData<UnitSchema>["state"], "idle" | "run" | "dead">>();
expectType<Exact<ComponentData<UnitSchema>["hp"], number>>();

// Numeric-only schemas keep resolving to number.
const vec2 = defineComponentSchema({ x: Float32Array, y: Float32Array });
expectType<Exact<ComponentValue<ComponentSchema<typeof vec2>>, { x: number; y: number }>>();
expectType<Exact<ComponentData<ComponentSchema<typeof vec2>>, { x: number; y: number }>>();

const Unit = new Component({ name: "unit", schema: unitSchema });
const world = new World({ capacity: 16, components: [Unit] });
const entity = world.entities.createOrThrow();
const instance = world.components.require(Unit);

const hpColumn: Uint16Array = instance.storage.partitions.hp;
const aliveColumn: Uint8Array = instance.storage.partitions.alive;
const stateColumn: Uint8Array | Uint16Array = instance.storage.partitions.state;
const targetColumn: Int32Array = instance.storage.partitions.target;
const labelColumn: string[] = instance.storage.partitions.label;
const meshColumn: (Mesh | null)[] = instance.storage.partitions.mesh;

const data = world.components.getEntityData(Unit, entity);
const alive: boolean = data.alive;
const state: "idle" | "run" | "dead" = data.state;
const target: Entity | null = data.target;
const mesh: Mesh | null = data.mesh;

world.components.setEntityData(Unit, entity, { alive: true, state: "run", target: entity, label: "a", mesh: null });
world.components.addToEntity(Unit, entity, { mesh: new Mesh() });

// @ts-expect-error bool fields take booleans.
world.components.setEntityData(Unit, entity, { alive: 1 });
// @ts-expect-error enum fields take their labels.
world.components.setEntityData(Unit, entity, { state: "fly" });
// @ts-expect-error string fields take strings.
world.components.setEntityData(Unit, entity, { label: 1 });
// @ts-expect-error object fields take their declared type.
world.components.setEntityData(Unit, entity, { mesh: { kind: "other" } });

instance.proxy.entity = entity;
const proxyState: "idle" | "run" | "dead" = instance.proxy.state;
instance.proxy.alive = false;
// @ts-expect-error proxy enum writes take labels.
instance.proxy.state = 1;

const viaGet: "idle" | "run" | "dead" = instance.get(entity, "state");
const viaGetHp: number = instance.get(entity, "hp");
instance.set(entity, "label", "b");

const game = createEcsWorld({
  capacity: 16,
  components: {
    Unit: { hp: Uint16Array, state: field.enum(["a", "b"]), mesh: field.object<Mesh>() },
  },
});
game.spawn({ Unit: { state: "a", mesh: new Mesh() } });
// @ts-expect-error createEcsWorld payloads are typed per field.
game.spawn({ Unit: { state: "c" } });
const gameMeshes: (Mesh | null)[] = game.storage.Unit.partitions.mesh;

void [hpColumn, aliveColumn, stateColumn, targetColumn, labelColumn, meshColumn];
void [alive, state, target, mesh, proxyState, viaGet, viaGetHp, gameMeshes];
