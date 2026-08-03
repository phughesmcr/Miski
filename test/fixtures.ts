import { Component, defineComponentSchema, World } from "../mod.ts";
import type { ComponentSchema, ComponentSpec, DynamicComponent, Entity } from "../mod.ts";
import { assert } from "./helpers.ts";

export const vec2Schema = defineComponentSchema({ x: Float32Array, y: Float32Array });
export type Vec2 = ComponentSchema<typeof vec2Schema>;

export function vec2Component(
  name = "position",
  options?: Pick<ComponentSpec<Vec2>, "maxEntities">,
): Component<Vec2> {
  return new Component<Vec2>({
    name,
    schema: vec2Schema,
    ...options,
  });
}

export function tagComponent(
  name: string,
  options?: Pick<ComponentSpec<null>, "maxEntities">,
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
