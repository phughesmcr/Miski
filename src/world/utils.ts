import { isValidComponentArray } from "@/component/component.ts";
import { MIN_WORLD_CAPACITY } from "@/constants.ts";
import { WorldStateError } from "@/errors.ts";
import type { WorldSpec, WorldState } from "@/types/world-api.ts";
import { isObject, isPositiveUint32 } from "@/utils.ts";

function hasUniqueComponentNames(components: WorldSpec["components"]): boolean {
  const names = new Set<string>();
  for (const component of components) {
    if (names.has(component.name)) return false;
    names.add(component.name);
  }
  return true;
}

/**
 * Test if an object is a valid WorldSpec
 * @param spec The object to test
 * @returns `true` if the object is a valid WorldSpec, `false` otherwise
 */
export function isValidWorldSpec(spec: unknown): spec is WorldSpec {
  if (isObject(spec) === false) return false;
  const { capacity, components } = spec;
  return isPositiveUint32(capacity) && capacity >= MIN_WORLD_CAPACITY && isValidComponentArray(components) &&
    components.length > 0 && hasUniqueComponentNames(components);
}

/**
 * Assert that the World is in the correct state
 * @param target - The target state
 * @param current - The current state
 * @throws {WorldStateError} - If the World is not in the correct state
 */
export function assertWorldState(target: WorldState, current: WorldState): void {
  if (current === target) return;
  switch (current) {
    case "uninitialized":
      throw new WorldStateError("World has not been initialized");
    case "initialized":
      throw new WorldStateError("World has already been initialized");
    case "destroyed":
      throw new WorldStateError("World has already been destroyed");
    case "error":
      throw new WorldStateError("World has encountered an error");
  }
}
