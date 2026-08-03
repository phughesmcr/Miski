import { CapacityError } from "@/errors.ts";
import type { ArchetypeManager } from "@/archetype/archetype-manager.ts";
import type { Component } from "@/component/component.ts";
import type { ComponentManager } from "@/component/component-manager.ts";
import type { EntityManager } from "@/entity/entity-manager.ts";
import type { QueryManager } from "@/query/query-manager.ts";
import type { SystemManager } from "@/system/system-manager.ts";
import type { Query } from "@/query/query.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { Entity, QueryEntityList } from "@/entity/entity.ts";
import type { ComponentData, SchemaOrNull, SchemaValues } from "@/types/partitions.ts";
import type {
  ComponentBundle,
  ComponentBundleEntryInput,
  WorldAPIResult,
  WorldArchetypeAPI,
  WorldComponentAPI,
  WorldEntityAPI,
  WorldSystemAPI,
} from "@/types/world-api.ts";
import type { WorldMutations } from "./world-mutations.ts";

type ComponentReference<
  TValue extends SchemaOrNull,
  TStorage extends SchemaOrNull = TValue,
> = Component<TValue, TStorage> | string;

type ComponentDataInput<TValue extends SchemaOrNull> = Partial<Record<keyof TValue, number>>;

/** Mutation methods the public API facades invoke via {@link WorldMutations}. */
type WorldApiMutations = Pick<
  WorldMutations,
  | "addComponentToEntity"
  | "addComponentToEntities"
  | "addBundleToEntity"
  | "removeComponentFromEntity"
  | "removeComponentFromEntities"
  | "createEntity"
  | "createEntityWithBundle"
>;

/**
 * Host surface required to build the public World API facades.
 * World supplies managers, mutations, and bound query/snapshot helpers.
 */
export type WorldApiHost = {
  assertInitialized(): void;
  assertSystemRegistrationAvailable(): void;

  readonly archetypeManager: ArchetypeManager;
  readonly componentManager: ComponentManager;
  readonly entityManager: EntityManager;
  readonly queryManager: QueryManager;
  readonly systemManager: SystemManager;
  readonly mutations: WorldApiMutations;

  getComponentEntityData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): ComponentData<TValue>;
  readComponentEntityData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): ComponentData<TValue> | undefined;
  readComponentEntityDataInto<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
    out: Partial<ComponentData<TValue>>,
  ): boolean;
  markComponentChanged<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
  ): void;
  setComponentEntityData<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: ComponentReference<TValue, TStorage>,
    entity: Entity,
    value: ComponentDataInput<TValue>,
  ): void;
  destroyEntity(entity: Entity): void;

  snapshotIterator(iterator: IterableIterator<Entity> | undefined): Entity[] | undefined;
  copyEntityList(list: QueryEntityList): Entity[];
  queryArchetypeEntities(query: Query): IterableIterator<Entity>;
  queryArchetypeEntered(query: Query): IterableIterator<Entity>;
  queryArchetypeExited(query: Query): IterableIterator<Entity>;
};

/** Build the four public World API objects from a host. */
export function constructWorldAPIs(host: WorldApiHost): WorldAPIResult {
  return {
    archetypes: constructArchetypeAPI(host),
    components: constructComponentAPI(host),
    entities: constructEntityAPI(host),
    systems: constructSystemAPI(host),
  };
}

function constructArchetypeAPI(host: WorldApiHost): WorldArchetypeAPI {
  return {
    getEntityArchetype: (entity: Entity) => host.archetypeManager.getEntityArchetype(entity)?.id,
    isEntityInRoot: (entity: Entity) => host.archetypeManager.isEntityInRoot(entity),
    queryComponents: (query: Query) => {
      host.assertInitialized();
      return host.queryManager.components(query);
    },
    queryEntities: (query: Query) => {
      host.assertInitialized();
      return host.queryArchetypeEntities(query);
    },
    queryEntered: (query: Query) => {
      host.assertInitialized();
      return host.queryArchetypeEntered(query);
    },
    queryExited: (query: Query) => {
      host.assertInitialized();
      return host.queryArchetypeExited(query);
    },
  };
}

function constructComponentAPI(host: WorldApiHost): WorldComponentAPI {
  return {
    count: host.componentManager.count,
    registry: host.componentManager.registry,
    addToEntity: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
      data?: Partial<SchemaValues<TValue>> | undefined,
    ) => {
      host.assertInitialized();
      // SchemaValues<T> values are always numeric; storage internals speak plain numbers.
      host.mutations.addComponentToEntity(component, entity, data as ComponentDataInput<TValue> | undefined);
    },
    addToEntities: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entities: QueryEntityList,
      data?: Partial<SchemaValues<TValue>> | undefined,
    ) => {
      host.assertInitialized();
      return host.mutations.addComponentToEntities(
        component,
        entities,
        data as ComponentDataInput<TValue> | undefined,
      );
    },
    addBundle: <const TBundle extends readonly ComponentBundleEntryInput[]>(
      entity: Entity,
      bundle: TBundle & ComponentBundle<TBundle>,
    ) => {
      host.assertInitialized();
      host.mutations.addBundleToEntity(entity, bundle);
    },
    entityHas: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
    ) => host.componentManager.entityHas(component, entity),
    getChanged: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
    ) => host.componentManager.getChanged(component),
    getChangedSnapshot: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
    ) => host.snapshotIterator(host.componentManager.getChanged(component)),
    getEntityData: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
    ) => host.getComponentEntityData(component, entity),
    readEntityData: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
    ) => host.readComponentEntityData(component, entity),
    readEntityDataInto: <
      TValue extends SchemaOrNull,
      TStorage extends SchemaOrNull = TValue,
    >(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
      out: Partial<ComponentData<TValue>>,
    ) => host.readComponentEntityDataInto(component, entity, out),
    getInstance: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
    ) => host.componentManager.getInstance(component),
    require: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
    ) => host.componentManager.require(component),
    getInstances: (array: DynamicComponent[] | Readonly<DynamicComponent[]>) =>
      host.componentManager.getInstances(array),
    getOwners: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
    ) => host.componentManager.getOwners(component),
    getOwnersSnapshot: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
    ) => host.snapshotIterator(host.componentManager.getOwners(component)),
    isRegistered: (component: DynamicComponent | string) => host.componentManager.isRegistered(component),
    markChanged: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
    ) => {
      host.assertInitialized();
      host.markComponentChanged(component, entity);
    },
    query: (query: Query) => {
      host.assertInitialized();
      return host.queryManager.components(query);
    },
    removeFromEntity: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
    ) => {
      host.assertInitialized();
      host.mutations.removeComponentFromEntity(component, entity);
    },
    removeFromEntities: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entities: QueryEntityList,
    ) => {
      host.assertInitialized();
      return host.mutations.removeComponentFromEntities(component, entities);
    },
    setEntityData: <TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
      component: ComponentReference<TValue, TStorage>,
      entity: Entity,
      value: Partial<SchemaValues<TValue>>,
    ) => {
      host.assertInitialized();
      // SchemaValues<T> values are always numeric; storage internals speak plain numbers.
      host.setComponentEntityData(component, entity, value as ComponentDataInput<TValue>);
    },
  };
}

function constructEntityAPI(host: WorldApiHost): WorldEntityAPI {
  return {
    capacity: host.entityManager.capacity,
    create: () => {
      host.assertInitialized();
      return host.mutations.createEntity();
    },
    createWith: <const TBundle extends readonly ComponentBundleEntryInput[]>(
      bundle: TBundle & ComponentBundle<TBundle>,
    ) => {
      host.assertInitialized();
      return host.mutations.createEntityWithBundle(bundle, false);
    },
    createOrThrow: () => {
      host.assertInitialized();
      const entity = host.mutations.createEntity();
      if (entity === undefined) {
        throw new CapacityError(`World is at capacity (${host.entityManager.capacity} entities).`);
      }
      return entity;
    },
    createWithOrThrow: <const TBundle extends readonly ComponentBundleEntryInput[]>(
      bundle: TBundle & ComponentBundle<TBundle>,
    ) => {
      host.assertInitialized();
      return host.mutations.createEntityWithBundle(bundle, true)!;
    },
    destroy: (entity: Entity) => {
      host.assertInitialized();
      host.destroyEntity(entity);
    },
    getActive: (startEntity?: Entity, endEntity?: Entity) => host.entityManager.getActive(startEntity, endEntity),
    getActiveSnapshot: (startEntity?: Entity, endEntity?: Entity) =>
      host.snapshotIterator(host.entityManager.getActive(startEntity, endEntity)) ?? [],
    getActiveCount: () => host.entityManager.getActiveCount(),
    getAvailableCount: () => host.entityManager.getAvailableCount(),
    isActive: (entity: Entity) => host.entityManager.isActive(entity),
    isEntity: (entity: Entity) => host.entityManager.isEntity(entity),
    query: (query: Query) => {
      host.assertInitialized();
      return host.queryManager.entities(query);
    },
    queryList: (query: Query) => {
      host.assertInitialized();
      return host.queryManager.entityList(query);
    },
    querySnapshot: (query: Query) => {
      host.assertInitialized();
      return host.copyEntityList(host.queryManager.entityList(query));
    },
    toArray: (list: QueryEntityList) => host.copyEntityList(list),
  };
}

function constructSystemAPI(host: WorldApiHost): WorldSystemAPI {
  const systemManager = host.systemManager;
  return {
    get registry() {
      return systemManager.registry;
    },
    create: (system) => {
      host.assertSystemRegistrationAvailable();
      return host.systemManager.create(system);
    },
    get: ((system: string) => host.systemManager.get(system)) as WorldSystemAPI["get"],
    has: (system) => host.systemManager.has(system),
    destroy: (system) => {
      host.assertSystemRegistrationAvailable();
      return host.systemManager.destroy(system);
    },
  };
}
