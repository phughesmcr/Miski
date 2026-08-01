import type { World } from "@/world/world.ts";

const captureRollbackState = Symbol("captureWorldRollbackState");
const commitRollbackState = Symbol("commitWorldRollbackState");
const validateRollbackState = Symbol("validateWorldRollbackState");
const restoreRollbackState = Symbol("restoreWorldRollbackState");

interface WorldRollbackHost {
  [captureRollbackState](): unknown;
  [commitRollbackState](state: unknown): void;
  [validateRollbackState](state: unknown): void;
  [restoreRollbackState](state: unknown): void;
}

/** Opaque, owner-bound point captured for a speculative world mutation. */
export type WorldRollbackPoint = Readonly<Record<PropertyKey, never>>;

type RollbackData = {
  readonly owner: World;
  readonly state: unknown;
};

const rollbackData = new WeakMap<object, RollbackData>();

/** Capture an opaque, owner-bound ECS rollback point. */
export function captureWorldRollbackPoint(world: World): WorldRollbackPoint {
  const host = world as unknown as WorldRollbackHost;
  const point = Object.freeze({}) as WorldRollbackPoint;
  rollbackData.set(point, { owner: world, state: host[captureRollbackState]() });
  return point;
}

/** Commit writes and close the owner-bound rollback scope. */
export function commitWorldRollbackPoint(
  world: World,
  point: WorldRollbackPoint,
): void {
  const host = world as unknown as WorldRollbackHost;
  const data = requireRollbackData(world, point);
  host[validateRollbackState](data.state);
  rollbackData.delete(point);
  host[commitRollbackState](data.state);
}

/** Restore once; validation completes before the point is consumed. */
export function restoreWorldRollbackPoint(
  world: World,
  point: WorldRollbackPoint,
): void {
  const host = world as unknown as WorldRollbackHost;
  const data = requireRollbackData(world, point);
  host[validateRollbackState](data.state);
  rollbackData.delete(point);
  host[restoreRollbackState](data.state);
}

function requireRollbackData(world: World, point: WorldRollbackPoint): RollbackData {
  const data = rollbackData.get(point);
  if (data === undefined || data.owner !== world) {
    throw new TypeError("Invalid or consumed world rollback point.");
  }
  return data;
}

export { captureRollbackState, commitRollbackState, restoreRollbackState, validateRollbackState };
