import { WorldStateError } from "@/errors.ts";
import type { World } from "@/world/world.ts";

/** @internal World hook that opens the world's one rollback scope and returns its captured state. */
const captureRollbackState = Symbol("captureWorldRollbackState");
/** @internal World hook that validates the captured state, keeps every write and closes the scope. */
const commitRollbackState = Symbol("commitWorldRollbackState");
/** @internal World hook that validates the captured state, restores it and closes the scope. */
const restoreRollbackState = Symbol("restoreWorldRollbackState");

interface WorldRollbackHost {
  [captureRollbackState](): unknown;
  [commitRollbackState](state: unknown): void;
  [restoreRollbackState](state: unknown): void;
}

/**
 * Speculative world mutation that can be kept or undone. A world has at most one open scope; while it is open,
 * another scope can't open and world saves can't load. Leaving a `using` block without calling `commit()` restores
 * the world, so a throw between opening and committing can't leave the scope open.
 *
 * `commit()`, `restore()` and disposal each close the scope, even when they throw, so a scope is closed at most
 * once.
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
  #state: unknown;
  #open: boolean;

  /**
   * Capture the world's ECS state and open the scope.
   * @throws {WorldStateError} - If the world is not initialized, or another rollback scope is already open on it
   */
  constructor(world: World) {
    this.#world = world;
    this.#state = (world as unknown as WorldRollbackHost)[captureRollbackState]();
    this.#open = true;
  }

  /** Whether the scope is still open: neither committed, restored nor disposed. */
  get isOpen(): boolean {
    return this.#open;
  }

  /**
   * Keep every write made since the scope opened, and close it.
   * @throws {WorldStateError} - If the scope is already closed, or the world is not initialized
   */
  commit(): void {
    (this.#world as unknown as WorldRollbackHost)[commitRollbackState](this.#take());
  }

  /**
   * Undo every write made since the scope opened, and close it.
   * @throws {WorldStateError} - If the scope is already closed, or the world is not initialized
   */
  restore(): void {
    (this.#world as unknown as WorldRollbackHost)[restoreRollbackState](this.#take());
  }

  /**
   * Close the scope at the end of a `using` block: restores the world if the scope is still open. A world
   * that is no longer initialized (errored or destroyed) can't be restored, so the captured state is just dropped.
   */
  [Symbol.dispose](): void {
    if (!this.#open) return;
    if (this.#world.state !== "initialized") {
      this.#take();
      return;
    }
    this.restore();
  }

  #take(): unknown {
    if (!this.#open) throw new WorldStateError("World rollback scope is already closed.");
    const state = this.#state;
    this.#open = false;
    this.#state = undefined;
    return state;
  }
}

export { captureRollbackState, commitRollbackState, restoreRollbackState };
