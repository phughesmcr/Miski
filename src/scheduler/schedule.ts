import { AlreadyRegisteredError, ArgumentError, SpecError, WorldStateError } from "@/errors.ts";
import { System } from "@/system/system.ts";
import type { ComponentMap } from "@/types/component.ts";
import type {
  ScheduleClock,
  ScheduleContext,
  SchedulePhaseSpec,
  ScheduleSpec,
  ScheduleSystemOptions,
  ScheduleSystemReference,
} from "@/types/scheduler.ts";
import { isObject } from "@/utils.ts";
import { World } from "@/world/world.ts";
import { CommandBuffer } from "./command-buffer.ts";
import { orderNodes } from "./order.ts";

const DEFAULT_PHASES: readonly SchedulePhaseSpec[] = ["update"];
const DEFAULT_FIXED_STEP = 1 / 60;
const DEFAULT_MAX_FIXED_STEPS = 8;

/**
 * Relative tolerance for "a whole fixed step is due". Frame `dt`s that should sum to exactly one step can fall short
 * of it by a rounding error (nine `1 / 540` frames against a `1 / 60` step, for example), which without a tolerance
 * would delay that step by a frame.
 */
const FIXED_STEP_TOLERANCE = 1e-9;

/**
 * Reduce an accumulator that still holds a whole fixed step (or within the tolerance of one) to its remainder, so it
 * always ends in `[0, threshold)` and `alpha` stays below 1. The whole steps are dropped.
 */
function dropWholeSteps(accumulator: number, step: number, threshold: number): number {
  if (accumulator < threshold) return accumulator;
  accumulator %= step;
  return accumulator < threshold ? accumulator : 0;
}

/** A system a schedule can run: it takes the schedule context as its one argument, or no argument. */
// deno-lint-ignore no-explicit-any
type AnySystem = System<any, any, any>;

type Entry = {
  readonly name: string;
  readonly system: AnySystem;
  readonly instance: (context: ScheduleContext) => unknown;
  readonly phase: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly runIf: ((context: ScheduleContext) => boolean) | undefined;
  readonly seq: number;
  enabled: boolean;
};

/** The mutable state behind the read-only context handed to systems. */
class ScheduleContextState implements ScheduleContext {
  readonly world: World;
  readonly commands: CommandBuffer;
  phase = "";
  fixed = false;
  // Numeric fields start as numbers so writes on the hot path keep one field representation.
  dt = 0;
  time = 0;
  tick = 0;
  fixedTick = 0;
  alpha = 0;

  constructor(world: World, commands: CommandBuffer) {
    this.world = world;
    this.commands = commands;
  }
}

function referenceName(reference: unknown): string {
  if (typeof reference === "string" && reference.length > 0) return reference;
  if (isObject(reference) && typeof reference["name"] === "string") return reference["name"];
  throw new SpecError("Schedule system references must be System objects or system names");
}

function referenceNames(references: unknown, owner: string, relation: string): string[] {
  if (references === undefined) return [];
  if (!Array.isArray(references)) throw new SpecError(`Schedule option "${relation}" must be an array`);
  const names: string[] = [];
  for (const reference of references) {
    const name = referenceName(reference);
    if (name === owner) throw new SpecError(`System "${owner}" cannot be ordered ${relation} itself`);
    names.push(name);
  }
  return names;
}

/**
 * Runs systems in phases, in a deterministic order, with an optional fixed timestep. This is the way to run
 * systems: `world.systems` owns their lifecycle (registration and `init` / `destroy` hooks), and `add()` registers
 * a system there if it is not registered yet. Calling a system's instance directly (from `world.systems.register`
 * or `world.systems.get`) bypasses the schedule entirely: enabled state, `runIf`, ordering, commands and refresh.
 *
 * - **Phases** run in the order given. Within a phase, systems run in the order they were added, adjusted by
 *   `before` / `after` constraints (ties keep insertion order). Cycles throw a `SpecError` naming the cycle.
 * - **Fixed phases** (contiguous) run once per fixed step: `run(dt)` adds `dt` to an accumulator and takes as many
 *   whole steps as are due, up to `maxFixedSteps`; whole steps beyond that are dropped. A step counts as due when the
 *   accumulator is within a relative `1e-9` of it, so rounding in the summed `dt`s does not delay it by a frame.
 *   Other phases run once per run.
 * - **Context**: each system receives one reused {@link ScheduleContext} (`dt`, `time`, `tick`, `alpha`, `commands`,
 *   ...). Declare `argCount: 1` (or `0` to ignore the context) to keep calls allocation-free; a system without
 *   `argCount` still runs, but its call forwards through rest/spread and may allocate.
 * - **Commands** queued on `context.commands` apply when the current phase (or fixed step) finishes.
 * - **Refresh**: `run()` calls `world.refresh()` once at the end, like `world.frame`, so every system sees the whole
 *   run's entered / exited / changed window.
 * - **Destroyed systems** leave the schedule: once a system is unregistered from the world (destroyed, or its init
 *   failed), the schedule drops it, as if `remove()` had been called. Re-registering it does not re-add it.
 *
 * The schedule's clock and pending commands are not part of rollback scopes.
 */
export class Schedule {
  readonly #world: World;
  readonly #commands: CommandBuffer;
  readonly #context: ScheduleContextState;
  readonly #phaseNames: readonly string[];
  readonly #phaseIndex: Map<string, number> = new Map();
  /** First fixed phase index, or -1 when there are none. */
  readonly #fixedStart: number;
  /** One past the last fixed phase index. */
  readonly #fixedEnd: number;
  readonly #fixedStep: number;
  /** The accumulator value at which a fixed step is due: `fixedStep` less the rounding tolerance. */
  readonly #stepThreshold: number;
  readonly #maxFixedSteps: number;

  readonly #entries: Map<string, Entry> = new Map();
  /** Entries to run per phase, in order; rebuilt when the schedule changes. */
  #plan: Entry[][] = [];
  #dirty = true;
  #nextSeq = 0;
  /**
   * The world's system registry when entries were last checked against it. The registry object is replaced
   * whenever a system is registered or unregistered, so a mismatch means an entry may be stale.
   */
  #registry: object | undefined;

  #accumulator = 0;
  #elapsed = 0;
  #running = false;

  /**
   * Create a schedule for a world.
   * @param world The world whose systems the schedule runs
   * @param spec Phases and fixed-step settings
   * @throws {SpecError} If the world or spec is invalid
   */
  constructor(world: World, spec: ScheduleSpec = {}) {
    if (!(world instanceof World)) throw new SpecError("Schedule requires a World");
    if (!isObject(spec)) throw new SpecError("Invalid ScheduleSpec");
    const { phases = DEFAULT_PHASES, fixedStep = DEFAULT_FIXED_STEP, maxFixedSteps = DEFAULT_MAX_FIXED_STEPS } = spec;
    if (!Array.isArray(phases) || phases.length === 0) throw new SpecError("Schedule needs at least one phase");
    if (typeof fixedStep !== "number" || !Number.isFinite(fixedStep) || fixedStep <= 0) {
      throw new SpecError("Schedule fixedStep must be a finite number greater than 0");
    }
    if (!Number.isInteger(maxFixedSteps) || maxFixedSteps < 1) {
      throw new SpecError("Schedule maxFixedSteps must be an integer of at least 1");
    }

    const names: string[] = [];
    let fixedStart = -1;
    let fixedEnd = -1;
    for (let i = 0; i < phases.length; i++) {
      const phase: unknown = phases[i];
      const name = typeof phase === "string" ? phase : isObject(phase) ? phase["name"] : undefined;
      const fixed = isObject(phase) ? phase["fixed"] : undefined;
      if (typeof name !== "string" || name.length === 0) {
        throw new SpecError("Schedule phase names must be non-empty strings");
      }
      if (fixed !== undefined && typeof fixed !== "boolean") {
        throw new SpecError(`Schedule phase "${name}" has a non-boolean "fixed" flag`);
      }
      if (this.#phaseIndex.has(name)) throw new SpecError(`Duplicate schedule phase "${name}"`);
      if (fixed === true) {
        if (fixedStart === -1) fixedStart = i;
        else if (fixedEnd !== i) throw new SpecError("Schedule fixed phases must be contiguous");
        fixedEnd = i + 1;
      }
      this.#phaseIndex.set(name, i);
      names.push(name);
    }

    this.#world = world;
    this.#commands = new CommandBuffer(world);
    this.#context = new ScheduleContextState(world, this.#commands);
    this.#phaseNames = Object.freeze(names);
    this.#fixedStart = fixedStart;
    this.#fixedEnd = fixedEnd;
    this.#fixedStep = fixedStep;
    this.#stepThreshold = fixedStep * (1 - FIXED_STEP_TOLERANCE);
    this.#maxFixedSteps = maxFixedSteps;
  }

  /** The phase names in run order. */
  get phases(): readonly string[] {
    return this.#phaseNames;
  }

  /** Seconds per fixed step. */
  get fixedStep(): number {
    return this.#fixedStep;
  }

  /** The most fixed steps one `run()` may take. */
  get maxFixedSteps(): number {
    return this.#maxFixedSteps;
  }

  /** Seconds accumulated toward the next fixed step; always less than `fixedStep`. */
  get accumulator(): number {
    return this.#accumulator;
  }

  /**
   * A copy of the schedule's clock, as plain data. Save it with a world save or rollback scope and pass it to
   * {@link setClock} when restoring, so the schedule resumes exactly where it was.
   */
  getClock(): ScheduleClock {
    return {
      tick: this.#context.tick,
      fixedTick: this.#context.fixedTick,
      elapsed: this.#elapsed,
      accumulator: this.#accumulator,
    };
  }

  /**
   * Restore a clock from {@link getClock}. Call it between runs, not from a system.
   *
   * An `accumulator` of a whole `fixedStep` or more (which `getClock()` never returns, but a clock saved from a
   * schedule with a larger step can hold) is reduced to its remainder: the whole steps are dropped, as `run()` drops
   * steps beyond `maxFixedSteps`. `accumulator` then reads back the reduced value.
   * @throws {ArgumentError} If a value is negative or not finite, or `tick` / `fixedTick` is not an integer
   * @throws {WorldStateError} If called during `run()`
   */
  setClock(clock: ScheduleClock): void {
    if (this.#running) throw new WorldStateError("Schedule.setClock() cannot be called while the schedule is running");
    if (!isObject(clock)) throw new ArgumentError("Schedule clock must be an object");
    const { tick, fixedTick, elapsed, accumulator } = clock;
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new ArgumentError(`Schedule clock tick must be an integer >= 0, got ${String(tick)}`);
    }
    if (!Number.isSafeInteger(fixedTick) || fixedTick < 0) {
      throw new ArgumentError(`Schedule clock fixedTick must be an integer >= 0, got ${String(fixedTick)}`);
    }
    if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) {
      throw new ArgumentError(`Schedule clock elapsed must be a finite number >= 0, got ${String(elapsed)}`);
    }
    if (typeof accumulator !== "number" || !Number.isFinite(accumulator) || accumulator < 0) {
      throw new ArgumentError(`Schedule clock accumulator must be a finite number >= 0, got ${String(accumulator)}`);
    }
    const step = this.#fixedStep;
    const reduced = dropWholeSteps(accumulator, step, this.#stepThreshold);
    const context = this.#context;
    context.tick = tick;
    context.fixedTick = fixedTick;
    context.time = elapsed;
    context.alpha = this.#fixedStart === -1 ? 0 : reduced / step;
    this.#elapsed = elapsed;
    this.#accumulator = reduced;
  }

  /** The context passed to systems (reused across calls; read-only to callers). */
  get context(): ScheduleContext {
    return this.#context;
  }

  /** The command buffer flushed at the end of each phase; the same object as `context.commands`. */
  get commands(): CommandBuffer {
    return this.#commands;
  }

  /**
   * Add a system. A system not yet registered in the world is registered (`world.systems.register`); a registered
   * one is reused. Membership and order changes made during `run()` take effect on the next run. A system that is
   * later unregistered from the world (destroyed, or its init failed) is dropped from the schedule.
   * @param system The system. It is called with the context as its one argument: declare `argCount: 1` (or `0` to
   * ignore it) so the call does not allocate. Without `argCount` it still runs, but may allocate per call.
   * @param options Phase, ordering constraints, run condition, and initial enabled state
   * @returns this schedule, for chaining
   * @throws {SpecError} If the system or the options are invalid, or the system declares an `argCount` of 2 or more
   * @throws {AlreadyRegisteredError} If the schedule already has a system with that name, or the world has a
   * different system with that name
   */
  add<TComponents extends ComponentMap, TArgs extends [] | [context: ScheduleContext], TReturn>(
    system: System<TComponents, TArgs, TReturn>,
    options: ScheduleSystemOptions = {},
  ): this {
    if (!(system instanceof System)) throw new SpecError("Schedule.add expects a System");
    this.#sync();
    const name = system.name;
    const argCount = system.argCount;
    if (argCount !== undefined && argCount !== 0 && argCount !== 1) {
      throw new SpecError(
        `System "${name}" declares argCount: ${argCount}, but a scheduled system receives only the schedule ` +
          "context: use argCount: 1 (or 0)",
      );
    }
    if (this.#entries.has(name)) throw new AlreadyRegisteredError(`System "${name}" is already in this schedule`);
    if (!isObject(options)) throw new SpecError("Invalid schedule options");
    const phaseName = options.phase ?? this.#phaseNames[0]!;
    const phase = this.#phaseIndex.get(phaseName);
    if (phase === undefined) throw new SpecError(`Unknown schedule phase "${String(phaseName)}"`);
    const before = referenceNames(options.before, name, "before");
    const after = referenceNames(options.after, name, "after");
    const { runIf, enabled = true } = options;
    if (runIf !== undefined && typeof runIf !== "function") {
      throw new SpecError("Schedule option runIf must be a function");
    }
    if (typeof enabled !== "boolean") throw new SpecError("Schedule option enabled must be a boolean");

    const systems = this.#world.systems;
    const instance = systems.get(system) ?? systems.register(system);
    this.#entries.set(name, {
      name,
      system,
      instance: instance as unknown as (context: ScheduleContext) => unknown,
      phase,
      before,
      after,
      runIf,
      seq: this.#nextSeq++,
      enabled,
    });
    this.#dirty = true;
    return this;
  }

  /**
   * Remove a system from the schedule. The system stays registered in the world.
   * @returns `true` if the system was in the schedule
   */
  remove(system: ScheduleSystemReference): boolean {
    const entry = this.#find(system);
    if (entry === undefined) return false;
    this.#entries.delete(entry.name);
    this.#dirty = true;
    return true;
  }

  /** Whether the schedule has the system. A system unregistered from the world is no longer in the schedule. */
  has(system: ScheduleSystemReference): boolean {
    return this.#find(system) !== undefined;
  }

  /**
   * Enable or disable a system. Takes effect immediately, including later in the current run.
   * @returns `true` if the system is in the schedule, or `false` (changing nothing) if it is not
   */
  setEnabled(system: ScheduleSystemReference, enabled: boolean): boolean {
    const entry = this.#find(system);
    if (entry === undefined) return false;
    entry.enabled = enabled === true;
    return true;
  }

  /** Whether the system is in the schedule and enabled. */
  isEnabled(system: ScheduleSystemReference): boolean {
    return this.#find(system)?.enabled === true;
  }

  /**
   * The names of a phase's systems in run order.
   * @throws {SpecError} If the phase is unknown or the ordering constraints are invalid
   */
  getOrder(phase: string): string[] {
    const index = this.#phaseIndex.get(phase);
    if (index === undefined) throw new SpecError(`Unknown schedule phase "${String(phase)}"`);
    this.#sync();
    if (this.#dirty) this.#build();
    return this.#plan[index]!.map((entry) => entry.name);
  }

  /**
   * Run one frame: every phase in order (fixed phases once per due fixed step), flushing commands after each phase,
   * then `world.refresh()`.
   *
   * If a system throws, pending commands are discarded, the world is refreshed if it can be, and the error is
   * rethrown. The clock has already advanced by `dt`: fixed steps that were still due are dropped, not replayed.
   * System callbacks run synchronously; a returned promise is not awaited.
   *
   * Systems unregistered from the world since the last call are dropped first (see {@link add}).
   * @param dt Seconds since the previous run (finite, >= 0)
   * @throws {ArgumentError} If `dt` is not a finite number >= 0
   * @throws {WorldStateError} If the world is not initialized, or `run()` is called from inside a run
   * @throws {SpecError} If the ordering constraints are invalid, including a constraint on a dropped system
   * @throws {WorldStateError} If a system's async init is still pending, or its destruction has started
   */
  run(dt: number): void {
    if (typeof dt !== "number" || !Number.isFinite(dt) || dt < 0) {
      throw new ArgumentError(`Schedule dt must be a finite number >= 0, got ${String(dt)}`);
    }
    if (this.#running) throw new WorldStateError("Schedule.run() is already running");
    const state = this.#world.state;
    if (state !== "initialized") throw new WorldStateError(`World is not initialized: state is "${state}"`);
    this.#sync();
    if (this.#dirty) this.#build();

    const context = this.#context;
    const step = this.#fixedStep;
    let steps = 0;
    context.tick++;
    this.#elapsed += dt;
    if (this.#fixedStart !== -1) {
      const threshold = this.#stepThreshold;
      let accumulator = this.#accumulator + dt;
      while (accumulator >= threshold && steps < this.#maxFixedSteps) {
        accumulator -= step;
        steps++;
      }
      // A step taken within the tolerance leaves a tiny negative remainder.
      if (accumulator < 0) accumulator = 0;
      accumulator = dropWholeSteps(accumulator, step, threshold);
      this.#accumulator = accumulator;
      context.alpha = accumulator / step;
    }

    // Snapshot the plan: a getOrder() call during the run may rebuild #plan, but membership changes apply next run.
    const plan = this.#plan;
    this.#running = true;
    try {
      const phaseCount = this.#phaseNames.length;
      for (let phase = 0; phase < phaseCount; phase++) {
        if (phase === this.#fixedStart) {
          context.dt = step;
          context.fixed = true;
          for (let i = 0; i < steps; i++) {
            context.fixedTick++;
            context.time = context.fixedTick * step;
            for (let fixedPhase = this.#fixedStart; fixedPhase < this.#fixedEnd; fixedPhase++) {
              this.#runPhase(plan, fixedPhase);
            }
          }
          context.fixed = false;
          phase = this.#fixedEnd - 1;
          continue;
        }
        context.dt = dt;
        context.time = this.#elapsed;
        this.#runPhase(plan, phase);
      }
    } catch (error) {
      this.#commands.clear();
      if (this.#world.state === "initialized") {
        try {
          this.#world.refresh();
        } catch {
          // refresh() already moved the world into the error state; the system's error is the one to report.
        }
      }
      throw error;
    } finally {
      this.#running = false;
      this.#context.fixed = false;
    }
    this.#world.refresh();
  }

  #runPhase(plan: readonly Entry[][], phase: number): void {
    const context = this.#context;
    const entries = plan[phase]!;
    context.phase = this.#phaseNames[phase]!;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (!entry.enabled) continue;
      if (entry.runIf !== undefined && entry.runIf(context) !== true) continue;
      entry.instance(context);
    }
    if (this.#commands.pendingCount > 0) this.#commands.flush();
  }

  /**
   * Drop entries whose system is no longer registered in the world with the instance captured by `add()`.
   * Costs one identity check unless the world's system registry has changed since the last call.
   */
  #sync(): void {
    const systems = this.#world.systems;
    const registry = systems.registry;
    if (registry === this.#registry) return;
    this.#registry = registry;
    for (const entry of this.#entries.values()) {
      if (systems.get(entry.system) !== entry.instance) {
        this.#entries.delete(entry.name);
        this.#dirty = true;
      }
    }
  }

  #find(system: ScheduleSystemReference): Entry | undefined {
    this.#sync();
    if (typeof system === "string") return this.#entries.get(system);
    if (!isObject(system) || typeof system["name"] !== "string") return undefined;
    const entry = this.#entries.get(system["name"]);
    return entry !== undefined && (!(system instanceof System) || entry.system === system) ? entry : undefined;
  }

  /** Resolve constraints and order each phase. Cold path; allocation is fine here. */
  #build(): void {
    const phaseEntries: Entry[][] = this.#phaseNames.map(() => []);
    for (const entry of this.#entries.values()) phaseEntries[entry.phase]!.push(entry);
    const localIndex = new Map<Entry, number>();
    for (const entries of phaseEntries) entries.forEach((entry, i) => localIndex.set(entry, i));
    const predecessors: number[][][] = phaseEntries.map((entries) => entries.map(() => []));

    const resolve = (owner: Entry, name: string, relation: string): Entry => {
      const target = this.#entries.get(name);
      if (target === undefined) {
        throw new SpecError(`System "${owner.name}" is ordered ${relation} "${name}", which is not in this schedule`);
      }
      return target;
    };
    const constrain = (first: Entry, second: Entry): void => {
      if (first.phase === second.phase) {
        predecessors[second.phase]![localIndex.get(second)!]!.push(localIndex.get(first)!);
      } else if (first.phase > second.phase) {
        throw new SpecError(
          `System "${second.name}" must run after "${first.name}", but phase "${this.#phaseNames[first.phase]}" ` +
            `runs after phase "${this.#phaseNames[second.phase]}"`,
        );
      }
    };
    for (const entry of this.#entries.values()) {
      for (const name of entry.after) constrain(resolve(entry, name, "after"), entry);
      for (const name of entry.before) constrain(entry, resolve(entry, name, "before"));
    }

    const plan: Entry[][] = [];
    for (let phase = 0; phase < phaseEntries.length; phase++) {
      const entries = phaseEntries[phase]!;
      const order = orderNodes(entries, predecessors[phase]!, `phase "${this.#phaseNames[phase]}"`);
      plan.push(order.map((i) => entries[i]!));
    }
    this.#plan = plan;
    this.#dirty = false;
  }
}
