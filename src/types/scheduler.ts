import type { CommandBuffer } from "@/scheduler/command-buffer.ts";
import type { World } from "@/world/world.ts";

/**
 * A placeholder for an entity queued by {@link CommandBuffer.spawn}.
 *
 * It is a negative number, so it never collides with a real entity handle. It is only valid in commands queued on the
 * same buffer before its next `flush()` or `clear()`.
 */
export type PendingEntity = number & { readonly __pendingEntityBrand: unique symbol };

/**
 * The context a {@link Schedule} passes to each scheduled system.
 *
 * One object is reused for every call, so systems must not keep it beyond their own call.
 */
export interface ScheduleContext {
  /** The world the schedule runs on. */
  readonly world: World;
  /** The schedule's command buffer; commands queued here apply when the current phase finishes. */
  readonly commands: CommandBuffer;
  /** The name of the phase being run. */
  readonly phase: string;
  /** Whether the current phase is a fixed-rate phase. */
  readonly fixed: boolean;
  /** Seconds simulated by this call: the fixed step in fixed phases, otherwise the `dt` passed to `run()`. */
  readonly dt: number;
  /**
   * The clock at the end of the current step: fixed steps completed times the fixed step in fixed phases, otherwise
   * the total `dt` passed to `run()` so far, including the current run.
   */
  readonly time: number;
  /** The number of `run()` calls started so far, including the current one. */
  readonly tick: number;
  /** The number of fixed steps run so far, including the current one in fixed phases. */
  readonly fixedTick: number;
  /** The unsimulated fraction of a fixed step left after this run's fixed steps, from 0 up to (but not including) 1. */
  readonly alpha: number;
}

/** A phase in a {@link ScheduleSpec}: a name, or a name with `fixed: true` for a fixed-rate phase. */
export type SchedulePhaseSpec = string | {
  /** The phase name. */
  readonly name: string;
  /** Whether the phase runs at the schedule's fixed step instead of once per `run()`. */
  readonly fixed?: boolean;
};

/** The specification for a {@link Schedule}. */
export type ScheduleSpec = {
  /**
   * The phases in run order (default `["update"]`). Fixed phases must be contiguous: each fixed step runs every fixed
   * phase in order.
   */
  readonly phases?: readonly SchedulePhaseSpec[];
  /** Seconds per fixed step (default `1 / 60`). */
  readonly fixedStep?: number;
  /** The most fixed steps one `run()` may take; whole steps beyond it are dropped (default 8). */
  readonly maxFixedSteps?: number;
};

/** A scheduled system, referred to by name or by the System object. */
export type ScheduleSystemReference = string | { readonly name: string };

/** Options for adding a system to a {@link Schedule}. */
export type ScheduleSystemOptions = {
  /** The phase to run in (default: the first phase). */
  readonly phase?: string;
  /** Systems this one must run before. Systems in an earlier phase are an error; a later phase is already satisfied. */
  readonly before?: readonly ScheduleSystemReference[];
  /** Systems this one must run after. Systems in a later phase are an error; an earlier phase is already satisfied. */
  readonly after?: readonly ScheduleSystemReference[];
  /** Checked before each call; the system runs only when it returns `true`. */
  readonly runIf?: ((context: ScheduleContext) => boolean) | undefined;
  /** Whether the system starts enabled (default `true`). */
  readonly enabled?: boolean;
};
