/**
 * @name        StepManager
 * @description Manages the game loop/time step functions
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { World } from "../world";

export interface StepManagerSpec {
  maxUpdates: number;
  tempo: number;
}

export interface StepManager {
  post: (alpha: number) => void;
  pre: () => void;
  /**
   * Perform one complete step.
   * i.e. Pre > Update > Post
   * @param time the current DOMHighResTimeStamp (e.g., from requestAnimationFrame)
   */
  step: (time: DOMHighResTimeStamp | number) => void;
  update: (delta: number) => void;
}

function _pre(world: World) {
  /**
   * Calls all system pre-update functions in order
   * @returns the world
   */
  function pre(): World {
    world.getPreSystems().forEach((system) => system.pre(system.entities));
    return world;
  }
  return pre;
}

function _post(world: World) {
  /**
   * Calls all system pre-update functions in order
   * @param alpha the frame's interpolation alpha
   * @returns the world
   */
  function post(alpha = 0): World {
    world.getPostSystems().forEach((system) => system.post(system.entities, alpha));
    world.refreshQueries();
    return world;
  }
  return post;
}

function _step(maxUpdates: number, tempo: number, world: World) {
  let acc = 0;
  let lastTime: DOMHighResTimeStamp | number | null = null;
  let lastUpdate = 0;

  const pre = _pre(world);
  const post = _post(world);
  const update = _update(world);

  /**
   * Perform one complete step.
   * i.e. Pre > Update > Post
   * @param time the current DOMHighResTimeStamp (e.g., from requestAnimationFrame)
   * @param overrideTempo an optional override tempo. defaults to configured `WorldSpec.tempo` (e.g., 1/60).
   */
  function step(time: DOMHighResTimeStamp | number = 0, overrideTempo: number = tempo): void {
    if (lastTime !== null) {
      acc += (time - lastTime) * 0.001;
      lastUpdate = 0;
      pre();
      while (acc > overrideTempo) {
        if (lastUpdate >= maxUpdates) {
          acc = 1;
          break;
        }
        update(overrideTempo);
        acc -= overrideTempo;
        lastUpdate++;
      }
    }
    lastTime = time;
    post(acc / tempo);
  }

  return step;
}

function _update(world: World) {
  /**
   * Call all system update functions in order
   * @param dt frame delta time
   * @returns the world
   */
  function update(delta = 0): World {
    world.getUpdateSystems().forEach((system) => system.update(system.entities, delta));
    return world;
  }
  return update;
}

export function createStepManager(world: World): StepManager {
  const { maxUpdates, tempo } = world.config;

  return {
    pre: _pre(world),
    post: _post(world),
    step: _step(maxUpdates, tempo, world),
    update: _update(world),
  };
}
