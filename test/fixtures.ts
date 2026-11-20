import { Component, defineComponentSchema, World } from "../mod.ts";
import type { ComponentSchema, ComponentSpec, DynamicComponent, Entity } from "../mod.ts";
import { assert } from "./helpers.ts";

/** A stand-in for an object-field value (a render mesh). */
export class Mesh {
  vertices: number[];
  constructor(vertices: number[] = []) {
    this.vertices = vertices;
  }
}

export const vec2Schema = defineComponentSchema({ x: Float32Array, y: Float32Array });
export type Vec2 = ComponentSchema<typeof vec2Schema>;

export function vec2Component(
  name = "position",
  options: Pick<ComponentSpec<Vec2>, "maxOwners"> = {},
): Component<Vec2> {
  return new Component<Vec2>({
    name,
    schema: vec2Schema,
    ...options,
  });
}

export function tagComponent(
  name: string,
  options?: Pick<ComponentSpec<null>, "maxOwners">,
): Component<null> {
  return new Component<null>({ name, ...options });
}

export function createEntity(world: World): Entity {
  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity to be created");
  return entity;
}

export async function createTestWorld(
  components: DynamicComponent[],
  capacity = 8,
): Promise<World> {
  const world = new World({ capacity, components });
  await world.init();
  return world;
}

export type GridPosValue = { x: number; y: number };
export type GridPosStorage = { x: Int16ArrayConstructor; y: Int16ArrayConstructor };
export type FacingValue = { dir: 0 | 1 | 2 | 3 };
export type FacingStorage = { dir: Uint8ArrayConstructor };
type HealthValue = { hp: number };
type HealthStorage = { hp: Uint16ArrayConstructor };

/** Grid-game components with branded value types: position, facing, a drawable tag, health and a door tag. */
export function gameComponents(): {
  GridPos: Component<GridPosValue, GridPosStorage>;
  Facing: Component<FacingValue, FacingStorage>;
  Drawable: Component<null>;
  Health: Component<HealthValue, HealthStorage>;
  Door: Component<null>;
} {
  return {
    GridPos: new Component<GridPosValue, GridPosStorage>({
      name: "gridPos",
      schema: { x: Int16Array, y: Int16Array },
    }),
    Facing: new Component<FacingValue, FacingStorage>({
      name: "facing",
      schema: { dir: Uint8Array },
    }),
    Drawable: new Component<null>({ name: "drawable" }),
    Health: new Component<HealthValue, HealthStorage>({
      name: "health",
      schema: { hp: Uint16Array },
    }),
    Door: new Component<null>({ name: "door" }),
  };
}
