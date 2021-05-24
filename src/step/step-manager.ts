// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { World } from '../world';

export interface StepManagerSpec {
  maxUpdates: number;
  tempo: number;
}

export interface StepManager {
  /**
   * Perform the world's pre-update step
   * @returns the world
   */
  pre: () => World;
  /**
   * Perform the world's post-update step
   * @param int the step's interpolation alpha
   * @returns the world
   */
  post: (int: number) => World;
  /**
   * Perform one complete step.
   * i.e. Pre > Update > Post
   * @param time the current time (e.g., from requestAnimationFrame)
   * @returns the world
   */
  step: (time: number) => World;
  /**
   * Perform the world's post-update step
   * @param dt the step's delta time
   * @returns the world
   */
  update: (dt: number) => World;
}

function createPre(world: World) {
  return function pre(): World {
    world.getPreSystems().forEach((system) => system.pre(system.entities, world.global));
    return world;
  };
}

function createPost(world: World) {
  return function post(int = 0): World {
    world.getPostSystems().forEach((system) => system.post(system.entities, world.global, int));
    world.refreshQueries();
    return world;
  };
}

function createStep(maxUpdates: number, tempo: number, world: World) {
  let acc = 0;
  let lastTime: DOMHighResTimeStamp | number | null = null;
  let lastUpdate = 0;
  const dt = tempo;

  return function step(time: DOMHighResTimeStamp | number = 0): World {
    if (lastTime !== null) {
      acc += (time - lastTime) * 0.001;
      lastUpdate = 0;
      world.pre();
      while (acc > dt) {
        if (lastUpdate >= maxUpdates) {
          acc = 1;
          break;
        }
        world.update(dt);
        acc -= dt;
        lastUpdate++;
      }
    }
    lastTime = time;
    world.post(acc / tempo);
    return world;
  };
}

function createUpdate(world: World) {
  return function update(dt = 0): World {
    world.getUpdateSystems().forEach((system) => system.update(system.entities, world.global, dt));
    return world;
  };
}

export function createStepManager(world: World, spec: StepManagerSpec): StepManager {
  const { maxUpdates, tempo } = spec;

  return {
    post: createPost(world),
    pre: createPre(world),
    step: createStep(maxUpdates, tempo, world),
    update: createUpdate(world),
  };
}
