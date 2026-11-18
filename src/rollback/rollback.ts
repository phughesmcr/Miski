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

/**
 * A world rollback point that closes itself. Leaving a `using` block without calling `commit()` restores the
 * world, so a throw between capture and commit can't leave the world's one rollback scope open (which would block
 * every later capture and every world load).
 *
 * @example
 * ```ts
 * {
 *   using scope = new WorldRollbackScope(world);
 *   simulateTurn(world);
 *   if (turnIsValid(world)) scope.commit(); // otherwise the world is restored on exit
 * }
 * ```
 */
export class WorldRollbackScope implements Disposable {
  readonly #world: World;
  #point: WorldRollbackPoint | undefined;

  /**
   * Capture a rollback point for `world` and open the scope.
   * @throws {WorldStateError} - If the world is not initialized
   * @throws {Error} - If another rollback scope is already active on the world
   */
  constructor(world: World) {
    this.#world = world;
    this.#point = captureWorldRollbackPoint(world);
  }

  /** Whether the scope is still open: neither committed, restored nor disposed. */
  get isOpen(): boolean {
    return this.#point !== undefined;
  }

  /**
   * Keep every write made since the scope opened, and close it.
   * @throws {TypeError} - If the scope is already closed
   */
  commit(): void {
    commitWorldRollbackPoint(this.#world, this.#take());
  }

  /**
   * Undo every write made since the scope opened, and close it.
   * @throws {TypeError} - If the scope is already closed
   */
  restore(): void {
    restoreWorldRollbackPoint(this.#world, this.#take());
  }

  /**
   * Close the scope at the end of a `using` block: restores the world if the scope is still open. A world
   * that is no longer initialized (errored or destroyed) can't be restored, so the point is just dropped.
   */
  [Symbol.dispose](): void {
    if (this.#point === undefined) return;
    if (this.#world.state !== "initialized") {
      this.#point = undefined;
      return;
    }
    this.restore();
  }

  #take(): WorldRollbackPoint {
    const point = this.#point;
    if (point === undefined) throw new TypeError("World rollback scope is already closed.");
    this.#point = undefined;
    return point;
  }
}

export { captureRollbackState, commitRollbackState, restoreRollbackState, validateRollbackState };
