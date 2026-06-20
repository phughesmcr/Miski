import { Component, World } from "../mod.ts";
import type { ComponentSpec, DynamicComponent, Entity } from "../mod.ts";
import { assert } from "./helpers.ts";

export type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

export function vec2Component(
  name = "position",
  options?: Pick<ComponentSpec<Vec2>, "maxEntities">,
): Component<Vec2> {
  return new Component<Vec2>({
    name,
    schema: { x: Float32Array, y: Float32Array },
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
