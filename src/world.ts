/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { createArchetypeManager } from "./archetype/manager.js";
import { Component, ComponentRecord } from "./component/component.js";
import { ComponentInstance } from "./component/instance.js";
import { createComponentManager } from "./component/manager.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { Entity } from "./entity.js";
import { createEntityManager } from "./entity.js";
import { bitfield, bitfieldCloner } from "./bitfield.js";
import { createQueryInstance, QueryInstance } from "./query/instance.js";
import { Query } from "./query/query.js";
import { isUint32 } from "./utils.js";
import { SchemaProps } from "./component/schema.js";

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
  getComponentInstance: <T>(component: Component<T> | string) => ComponentInstance<T> | undefined;
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

function createArchetypeArray(capacity: number) {
  const entityArchetypes: Archetype[] = [];
  entityArchetypes.length = capacity; // @note V8 hack, quicker/smaller than new Array(capacity)
  return entityArchetypes;
}

export function createWorld(spec: WorldSpec): Readonly<World> {
  const { components, capacity } = validateWorldSpec(spec);
  const entityArchetypes = createArchetypeArray(capacity);
  const bitfieldFactory = createBitfieldFactory(components.length);

  const { createEntity, destroyEntity, getEntityArchetype, getVacancyCount, hasEntity, setEntityArchetype } =
    createEntityManager({
      entityArchetypes,
      capacity,
    });

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

  const queryMap: Map<Query, QueryInstance> = new Map();

  function refresh() {
    const archetypes = [...archetypeMap.values()];
    const refresh = (instance: QueryInstance) => instance.refresh(archetypes);
    queryMap.forEach(refresh);
  }
  refresh();

  function getComponentInstance<T>(component: Component<T> | string): ComponentInstance<T> | undefined {
    if (typeof component === "string") {
      return [...componentMap.values()].filter((c) => c.name === component)[0] as ComponentInstance<T> | undefined;
    } else {
      return componentMap.get(component) as ComponentInstance<T> | undefined;
    }
  }

  /** @returns a tuple of Entities and Components which match the Query criteria */
  function getQueryResult(query: Query): [Entity[], ComponentRecord] {
    let instance = queryMap.get(query);
    if (!instance) {
      instance = createQueryInstance({ componentMap, bitfieldFactory, query });
      queryMap.set(query, instance);
    }
    return [instance.getEntities(), instance.getComponents()];
  }

  return Object.freeze(
    Object.assign(Object.create(WORLD_PROTO), {
      capacity,
      createEntity,
      destroyEntity,
      getComponentInstance,
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
