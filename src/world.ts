/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "./archetype/archetype.js";
import { createArchetypeManager } from "./archetype/manager.js";
import { Component, ComponentRecord } from "./component/component.js";
import { ComponentInstance } from "./component/instance.js";
import { createComponentManager } from "./component/manager.js";
import { DEFAULT_MAX_ENTITIES, VERSION } from "./constants.js";
import { Entity } from "./entity.js";
import { createEntityManager } from "./entity.js";
import { Bitfield, bitfield, bitfieldCloner } from "./bitfield.js";
import { createQueryInstance, QueryInstance } from "./query/instance.js";
import { Query } from "./query/query.js";
import { isUint32 } from "./utils.js";
import { SchemaProps } from "./component/schema.js";

export interface WorldSpec {
  /** Components to instantiate in the world  */
  components: Component<unknown>[];
  /** The maximum number of entities allowed in the world */
  entityCapacity: number;
}

export interface WorldProto {
  readonly version: string;
}

export interface WorldData extends WorldProto {
  archetypes: Map<string, Archetype>;
  availableEntities: Entity[];
  components: Map<Component<unknown>, ComponentInstance<unknown>>;
  emptyBitfield: Bitfield;
  entityArchetypes: Archetype[];
  entityCapacity: number;
  bitfieldFactory: (components?: ComponentInstance<unknown>[]) => Bitfield;
  queries: Map<Query, QueryInstance>;
}

export interface World extends WorldData {
  createEntity: () => number | undefined;
  destroyEntity: (entity: Entity) => boolean;
  getComponentInstance: <T>(component: Component<T> | string) => ComponentInstance<T> | undefined;
  getEntityArchetype: (entity: number) => Archetype | undefined;
  getQueryResult: (query: Query) => [Entity[], ComponentRecord];
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
  const { components = [], entityCapacity = DEFAULT_MAX_ENTITIES } = spec;
  if (!isUint32(entityCapacity)) throw new SyntaxError("World creation: spec.entityCapacity invalid.");
  if (!components.length) throw new SyntaxError("World creation: spec.components invalid.");
  return { components, entityCapacity };
}

function addBitfieldFactory({ capacity }: { capacity: number }) {
  const emptyBitfield = bitfield({ capacity });
  const bitfieldFactory = bitfieldCloner(emptyBitfield);
  return { emptyBitfield, bitfieldFactory };
}

function addAvailableEntityArray({ entityCapacity }: { entityCapacity: number }) {
  // @todo would this be better as a generator?
  const availableEntities: Entity[] = ((length: number) => {
    const total = length - 1;
    return Array.from({ length }, (_, i) => total - i);
  })(entityCapacity);
  return { availableEntities };
}

function addArchetypeArray({ entityCapacity }: { entityCapacity: number }) {
  const entityArchetypes: Archetype[] = [];
  entityArchetypes.length = entityCapacity; // @note V8 hack, quicker/smaller than new Array(capacity)
  return { entityArchetypes };
}

export function createWorld(spec: WorldSpec): Readonly<World> {
  const { components, entityCapacity } = validateWorldSpec(spec);
  const { availableEntities } = addAvailableEntityArray({ entityCapacity });
  const { entityArchetypes } = addArchetypeArray({ entityCapacity });
  const { emptyBitfield, bitfieldFactory } = addBitfieldFactory({ capacity: components.length });

  const { createEntity, destroyEntity, getEntityArchetype, hasEntity, setEntityArchetype } = createEntityManager({
    availableEntities,
    entityArchetypes,
    entityCapacity,
  });

  const { archetypeMap, updateArchetype } = createArchetypeManager({
    bitfieldFactory,
    getEntityArchetype,
    setEntityArchetype,
  });

  const { componentMap, addComponentToEntity, entityHasComponent, removeComponentFromEntity } = createComponentManager({
    components,
    entityCapacity,
    getEntityArchetype,
    updateArchetype,
  });

  const queries: Map<Query, QueryInstance> = new Map();

  const world: WorldData = Object.assign(Object.create(WORLD_PROTO), {
    entityCapacity,
    availableEntities,
    entityArchetypes,
    archetypes: archetypeMap,
    components: componentMap,
    queries,
    emptyBitfield,
    bitfieldFactory,
  }) as WorldData;

  function refresh() {
    const archetypes = [...archetypeMap.values()];
    const refresh = (instance: QueryInstance) => instance.refresh(archetypes);
    queries.forEach(refresh);
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
    let instance = queries.get(query);
    if (!instance) {
      instance = createQueryInstance({ componentMap, bitfieldFactory, query });
      queries.set(query, instance);
    }
    return [instance.getEntities(), instance.getComponents()];
  }

  return Object.freeze(
    Object.assign(Object.create(world), {
      createEntity,
      destroyEntity,
      getComponentInstance,
      getEntityArchetype,
      getQueryResult,
      hasEntity,
      addComponentToEntity,
      entityHasComponent,
      removeComponentFromEntity,
      refresh,
    }) as World,
  );
}
