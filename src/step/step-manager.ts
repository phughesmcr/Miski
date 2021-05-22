// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { World } from '../world';

export interface StepManagerSpec {
  maxUpdates: number;
  tempo: number;
}

export interface StepManager {
  /** Pre-update function */
  pre: () => World;
  /**
   * Post-update function
   * @param int
   */
  post: (int: number) => World;
  /**
   * Perform one complete step.
   * i.e. Pre > Update > Post
   */
  step: (time: number) => World;
  /**
   * Update function
   * @param dt delta-time
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
    world.updateQueries();
    return world;
  };
}

function createStep(maxUpdates: number, tempo: number, world: World) {
  let last: number | null = null;
  let acc = 0;
  const dt = tempo;

  return function step(time = 0): World {
    if (last !== null) {
      acc += (time - last) * 0.001;
      let updatesLast = 0;
      world.pre();
      while (acc > dt) {
        if (updatesLast >= maxUpdates) {
          acc = 1;
          break;
        }
        world.update(dt);
        acc -= dt;
        updatesLast++;
      }
    }
    last = time;
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
