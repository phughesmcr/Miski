/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { createArchetypeManager } from "./archetype/manager.js";
import { bitfield, bitfieldCloner } from "./bitfield.js";
import { Component, ComponentRecord } from "./component/component.js";
import { createComponentManager } from "./component/manager.js";
import { SchemaProps } from "./component/schema.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { createEntityManager, Entity } from "./entity.js";
import { QueryInstance } from "./query/instance.js";
import { createQueryManager } from "./query/manager.js";
import { Query } from "./query/query.js";
import { createSerializationManager, MiskiData } from "./serialize.js";
import { isUint32 } from "./utils.js";

export interface WorldSpec {
  /** The maximum number of entities allowed in the world */
  capacity: number;
  /** Components to instantiate in the world  */
  components: Component<unknown>[];
}

export interface WorldProto {
  readonly version: string;
}

export interface World extends WorldProto {
  readonly capacity: number;
  addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T> | undefined) => boolean;
  createEntity: () => Entity | undefined;
  destroyEntity: (entity: Entity) => boolean;
  entityHasComponent: <T>(component: Component<T>, entity: Entity) => boolean;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  getQueryEntered: (query: Query) => [Entity[], ComponentRecord];
  getQueryExited: (query: Query) => [Entity[], ComponentRecord];
  getQueryResult: (query: Query) => [Entity[], ComponentRecord];
  getVacancyCount: () => number;
  hasEntity: (entity: Entity) => boolean;
  load: (data: MiskiData) => boolean;
  purgeCaches: () => void;
  refresh: () => void;
  removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;
  save: () => Readonly<MiskiData>;
}

/** World.prototype - Miski version data etc. */
export const WORLD_PROTO: WorldProto = Object.freeze({
  version: VERSION,
});

function validateWorldSpec(spec: WorldSpec): Required<WorldSpec> {
  if (!spec) throw new SyntaxError("World creation requires a specification object.");
  const { capacity = DEFAULT_MAX_ENTITIES, components } = spec;
  if (!isUint32(capacity)) throw new SyntaxError("World creation: spec.capacity invalid.");
  if (!components.length) throw new SyntaxError("World creation: spec.components invalid.");
  return { capacity, components };
}

function createBitfieldFactory(capacity: number) {
  const emptyBitfield = bitfield({ capacity });
  const bitfieldFactory = bitfieldCloner(emptyBitfield);
  return bitfieldFactory;
}

export function createWorld(spec: WorldSpec): Readonly<World> {
  const { capacity, components } = validateWorldSpec(spec);
  const bitfieldFactory = createBitfieldFactory(components.length);

  const { createEntity, destroyEntity, getEntityArchetype, getVacancyCount, hasEntity, setEntityArchetype } =
    createEntityManager({ capacity });

  const { archetypeMap, updateArchetype } = createArchetypeManager({
    bitfieldFactory,
    getEntityArchetype,
    setEntityArchetype,
  });

  const { componentMap, addComponentToEntity, entityHasComponent, getBuffer, removeComponentFromEntity, setBuffer } =
    createComponentManager({
      capacity,
      components,
      getEntityArchetype,
      updateArchetype,
    });

  const { queryMap, getQueryEntered, getQueryExited, getQueryResult } = createQueryManager({
    bitfieldFactory,
    componentMap,
  });

  const { load, save } = createSerializationManager({ getBuffer, setBuffer });

  function purgeCaches() {
    const archetypes = [...archetypeMap.values()];
    const purgeArchetypes = (archetype: Archetype) => archetype.purge();
    archetypes.forEach(purgeArchetypes);
  }
  purgeCaches();

  function refresh() {
    const archetypes = [...archetypeMap.values()];
    const refreshQuery = (instance: QueryInstance) => instance.refresh(archetypes);
    queryMap.forEach(refreshQuery);
    const refreshArchetype = (archetype: Archetype) => archetype.refresh();
    archetypes.forEach(refreshArchetype);
  }
  refresh();

  return Object.freeze(
    Object.assign(Object.create(WORLD_PROTO), {
      capacity,
      addComponentToEntity,
      createEntity,
      destroyEntity,
      entityHasComponent,
      getEntityArchetype,
      getQueryEntered,
      getQueryExited,
      getQueryResult,
      getVacancyCount,
      hasEntity,
      load,
      purgeCaches,
      refresh,
      removeComponentFromEntity,
      save,
    }) as World,
  );
}
