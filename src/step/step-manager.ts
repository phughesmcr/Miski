// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { World } from '../world';

export interface StepManagerSpec {
  maxUpdates: number;
  tempo: number;
}

export interface StepManager {
  /**
   * Perform one complete step.
   * i.e. Pre > Update > Post
   * @param time the current DOMHighResTimeStamp (e.g., from requestAnimationFrame)
   */
  step: (time: number) => void;
}

function createPre(world: World) {
  /**
   * Calls all system pre-update functions in order
   * @returns the world
   */
  function pre(): World {
    world.getPreSystems().forEach((system) => system.pre(system.entities, world.global));
    return world;
  }
  return pre;
}

function createPost(world: World) {
  /**
   * Calls all system pre-update functions in order
   * @param int the frame's interpolation alpha
   * @returns the world
   */
  function post(int = 0): World {
    world.getPostSystems().forEach((system) => system.post(system.entities, world.global, int));
    world.refreshQueries();
    return world;
  }
  return post;
}

function createStep(maxUpdates: number, tempo: number, world: World) {
  let acc = 0;
  let lastTime: DOMHighResTimeStamp | number | null = null;
  let lastUpdate = 0;
  const dt = tempo;

  const pre = createPre(world);
  const post = createPost(world);
  const update = createUpdate(world);

  return function step(time: DOMHighResTimeStamp | number = 0): void {
    if (lastTime !== null) {
      acc += (time - lastTime) * 0.001;
      lastUpdate = 0;
      pre();
      while (acc > dt) {
        if (lastUpdate >= maxUpdates) {
          acc = 1;
          break;
        }
        update(dt);
        acc -= dt;
        lastUpdate++;
      }
    }
    lastTime = time;
    post(acc / tempo);
  };
}

function createUpdate(world: World) {
  /**
   * Call all system update functions in order
   * @param dt frame delta time
   * @returns the world
   */
  function update(dt = 0): World {
    world.getUpdateSystems().forEach((system) => system.update(system.entities, world.global, dt));
    return world;
  }
  return update;
}

export function createStepManager(world: World, spec: StepManagerSpec): StepManager {
  const { maxUpdates, tempo } = spec;

  return {
    step: createStep(maxUpdates, tempo, world),
  };
}
