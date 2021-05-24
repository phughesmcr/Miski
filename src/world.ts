// Copyright (c) 2021 P. Hughes. All rights reserved. MIT license.
"use strict";

import { Archetype } from './archetype/archetype';
import { createArchetypeManager } from './archetype/archetype-manager';
import { Component, ComponentSpec } from './component/component';
import { createComponentManager } from "./component/component-manager";
import { Entity } from './entity/entity';
import { createEntityManager } from './entity/entity-manager';
import { Query, QuerySpec } from './query/query';
import { createQueryManager } from './query/query-manager';
import { createStepManager } from './step/step-manager';
import { System, SystemSpec } from './system/system';
import { createSystemManager } from './system/system-manager';
import { FORBIDDEN_NAMES } from './utils';

export interface WorldSpec {
  entityPoolGrowthFactor?: number;
  initialEntityPoolSize?: number;
  maxComponents?: number;
  maxEntities?: number;
  maxUpdates?: number;
  tempo?: number;
}

export interface World {
  FORBIDDEN_NAMES: Readonly<string[]>,
  global: Entity;
  // archetype manager
  getArchetype: (id: bigint) => Archetype | undefined;
  getArchetypes: () => Archetype[];
  getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
  isArchetypeRegistered: (archetype: Archetype) => boolean;
  updateArchetype: (entity: Entity, prev?: bigint) => World;
  // component manager
  getComponentById: (id: bigint) => Component<unknown> | undefined;
  getComponentByName: (name: string) => Component<unknown> | undefined;
  getComponents: () => Component<unknown>[];
  isComponentRegistered: <T>(component: Component<T>) => boolean;
  registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
  unregisterComponent: <T>(component: Component<T>) => World;
  // entity manager
  createEntity: () => Entity;
  destroyEntity: (entity: Entity) => boolean;
  getEntities: () => Entity[];
  getEntityById: (id: string) => Entity | undefined;
  isEntityRegistered: (entity: Entity) => boolean;
  // query manager
  isQueryRegistered: (query: Query) => boolean;
  registerQuery: (spec: QuerySpec) => Query;
  refreshQueries: () => World;
  unregisterQuery: (query: Query) => World;
  // step manager
  pre: () => World;
  post: (int: number) => World;
  step: (time: number) => World;
  update: (dt: number) => World;
  // system manager
  getSystems: () => System[];
  getPostSystems: () => System[];
  getPreSystems: () => System[];
  getUpdateSystems: () => System[];
  getSystemByIdx: (idx: number) => System | undefined;
  getSystemByName: (name: string) => System | undefined;
  isSystemRegistered: (system: System) => boolean;
  moveSystem: (system: System, idx: number) => number;
  registerSystem: (spec: SystemSpec) => System;
  unregisterSystem: (system: System) => World;
}

/**
 * Creates a new World object
 * @param spec the world's specification object
 * @param spec.entityPoolGrowthFactor amount to grow the entity pool by once the
 *  initial entities have been used. Defaults to 0.25
 *  (i.e. once the pool grows beyond the initialEntityPoolSize, it will grow by
 *   initialEntityPoolSize * 0.25).
 * @param spec.initialEntityPoolSize the number of entities to pre-allocate. Defaults to 128.
 * @param spec.maxComponents the maximum number of components to allow. Defaults to 256.
 * @param spec.maxEntities the maximum number of entities to allow. Defaults to Number.POSITIVE_INFINITY.
 * @param spec.maxUpdates the maximum number of updates to allow before panicking. Defaults to 240.
 * @param spec.tempo the desired update rate. Defaults to 1/60 (i.e. 60fps, or 0.016).
 * @returns a new World object
 */
export function createWorld(spec: WorldSpec = {}): World {
  const {
    entityPoolGrowthFactor = 0.25,
    initialEntityPoolSize = 128,
    maxComponents = 256,
    maxEntities = Number.POSITIVE_INFINITY,
    maxUpdates = 240,
    tempo = 1 / 60,
  } = spec;

  const world = Object.create(null) as World;

  Object.assign(
    world,
    createArchetypeManager(world, {}),
    createComponentManager(world, {maxComponents}),
    createEntityManager(world, {entityPoolGrowthFactor, initialEntityPoolSize, maxEntities}),
    createQueryManager(world, {}),
    createStepManager(world, {maxUpdates, tempo}),
    createSystemManager(world, {}),
  );

  world.global = world.createEntity();
  world.FORBIDDEN_NAMES = [...FORBIDDEN_NAMES];

  return world;
}
