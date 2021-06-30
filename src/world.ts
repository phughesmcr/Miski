/**
 * @name        World
 * @description The primary context for the ECS.
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
"use strict";

import { ArchetypeManager, createArchetypeManager } from "./archetype/archetype-manager";
import { ComponentManager, createComponentManager } from "./component/component-manager";
import { createEntityManager, EntityManager } from "./entity/entity-manager";
import { createQueryManager, QueryManager } from "./query/query-manager";
import { createStepManager, StepManager } from "./step/step-manager";
import { createSystemManager, SystemManager } from "./system/system-manager";
import { generateId } from "./utils/strings";

export interface WorldSpec {
  maxComponents?: number;
  maxEntities?: number;
  maxUpdates?: number;
  tempo?: number;
}

export type World = ArchetypeManager &
  ComponentManager &
  EntityManager &
  QueryManager &
  StepManager &
  SystemManager & {
    config: Readonly<Required<WorldSpec>>;
    id: string;
  };

/**
 * Creates a new World object
 * @param spec the world's specification object
 * @param spec.maxComponents the maximum number of components to allow. Defaults to 256.
 * @param spec.maxEntities the maximum number of entities to allow. Defaults to 100,000.
 * @param spec.maxUpdates the maximum number of updates to allow before panicking. Defaults to 240.
 * @param spec.tempo the target update rate. Defaults to 1/60 (i.e. 60fps, or 0.016).
 * @returns a new World object
 */
export function createWorld(spec: WorldSpec = {}): World {
  const { maxComponents = 256, maxEntities = 100_000, maxUpdates = 240, tempo = 1 / 60 } = spec;

  const world = {
    config: Object.freeze({
      maxComponents,
      maxEntities,
      maxUpdates,
      tempo,
    }),
    id: generateId(),
  } as World;

  Object.assign(
    world,
    createArchetypeManager(world),
    createComponentManager(world),
    createEntityManager(world),
    createQueryManager(world),
    createStepManager(world),
    createSystemManager(world)
  );

  return world;
}
