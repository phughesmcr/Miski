/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { createArchetypeManager } from "./archetype/manager.js";
import { Component, ComponentRecord } from "./component/component.js";
import { createComponentManager } from "./component/manager.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { Entity } from "./entity.js";
import { createEntityManager } from "./entity.js";
import { bitfield, bitfieldCloner } from "./bitfield.js";
import { QueryInstance } from "./query/instance.js";
import { Query } from "./query/query.js";
import { isUint32 } from "./utils.js";
import { SchemaProps } from "./component/schema.js";
import { createQueryManager } from "./query/manager.js";

export interface WorldSpec {
  /** Components to instantiate in the world  */
  components: Component<unknown>[];
  /** The maximum number of entities allowed in the world */
  capacity: number;
}

export interface WorldProto {
  readonly version: string;
}

export interface World extends WorldProto {
  readonly capacity: number;
  createEntity: () => number | undefined;
  destroyEntity: (entity: Entity) => boolean;
  getEntityArchetype: (entity: number) => Archetype | undefined;
  getQueryResult: (query: Query) => [Entity[], ComponentRecord];
  getVacancyCount: () => number;
  hasEntity: (entity: number) => boolean;
  addComponentToEntity: <T>(component: Component<T>, entity: number, props?: SchemaProps<T> | undefined) => boolean;
  entityHasComponent: <T>(component: Component<T>, entity: number) => boolean;
  removeComponentFromEntity: <T>(component: Component<T>, entity: number) => boolean;
  refresh: () => void;
}

/** World.prototype - Miski version data etc. */
export const WORLD_PROTO: WorldProto = Object.freeze({
  version: VERSION,
});

function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  if (!spec) throw new SyntaxError("World creation requires a specification object.");
  const { components = [], capacity = DEFAULT_MAX_ENTITIES } = spec;
  if (!isUint32(capacity)) throw new SyntaxError("World creation: spec.capacity invalid.");
  if (!components.length) throw new SyntaxError("World creation: spec.components invalid.");
  return { components, capacity };
}

function createBitfieldFactory(capacity: number) {
  const emptyBitfield = bitfield({ capacity });
  const bitfieldFactory = bitfieldCloner(emptyBitfield);
  return bitfieldFactory;
}

export function createWorld(spec: WorldSpec): Readonly<World> {
  const { components, capacity } = validateWorldSpec(spec);
  const bitfieldFactory = createBitfieldFactory(components.length);

  const { createEntity, destroyEntity, getEntityArchetype, getVacancyCount, hasEntity, setEntityArchetype } =
    createEntityManager({ capacity });

  const { archetypeMap, updateArchetype } = createArchetypeManager({
    bitfieldFactory,
    getEntityArchetype,
    setEntityArchetype,
  });

  const { componentMap, addComponentToEntity, entityHasComponent, removeComponentFromEntity } = createComponentManager({
    components,
    capacity,
    getEntityArchetype,
    updateArchetype,
  });

  const { queryMap, getQueryResult } = createQueryManager({ bitfieldFactory, componentMap });

  function refresh() {
    const archetypes = [...archetypeMap.values()];
    const refreshQueries = (instance: QueryInstance) => instance.refresh(archetypes);
    queryMap.forEach(refreshQueries);
  }
  refresh();

  return Object.freeze(
    Object.assign(Object.create(WORLD_PROTO), {
      capacity,
      createEntity,
      destroyEntity,
      getEntityArchetype,
      getQueryResult,
      getVacancyCount,
      hasEntity,
      addComponentToEntity,
      entityHasComponent,
      removeComponentFromEntity,
      refresh,
    }) as World,
  );
}
