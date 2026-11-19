/// <reference lib="deno.ns" />

import { BooleanArray } from "@phughesmcr/booleanarray";

import { ArchetypeManager } from "../src/archetype/archetype-manager.ts";
import { Archetype } from "../src/archetype/archetype.ts";
import { ComponentManager } from "../src/component/component-manager.ts";
import { asEntity, asSlotIndex, ReusableEntityIterator } from "../src/entity/entity.ts";
import { EntityManager } from "../src/entity/entity-manager.ts";
import { EntityIteratorPool } from "../src/entity/pooled-entity-iterator.ts";
import { QueryManager } from "../src/query/query-manager.ts";
import { Query } from "../src/query/query.ts";
import { QueryEntityResult } from "../src/query/query-pool.ts";
import type { DynamicComponentInstance, QueryInstance } from "../src/types.ts";
import type { ComponentInstance } from "../mod.ts";
import { createBenchmarkComponents, MEDIUM_CAPACITY, SMALL_CAPACITY, type Vec2 } from "./fixtures.ts";

let entitySink = 0;
let numericSink = 0;
let objectSink: unknown;

const components = createBenchmarkComponents();
const componentManager = new ComponentManager(MEDIUM_CAPACITY, components.all);
const positionInstance = componentManager.getInstance(components.position) as ComponentInstance<Vec2>;
const velocityInstance = componentManager.getInstance(components.velocity) as ComponentInstance<Vec2>;
const renderableInstance = componentManager.getInstance(components.renderable) as ComponentInstance<null>;
const sleepingInstance = componentManager.getInstance(components.sleeping) as ComponentInstance<null>;
const accelerationInstance = componentManager.getInstance(components.acceleration) as ComponentInstance<Vec2>;

if (
  positionInstance === undefined ||
  velocityInstance === undefined ||
  renderableInstance === undefined ||
  sleepingInstance === undefined ||
  accelerationInstance === undefined
) {
  throw new Error("internal benchmark expected registered component instances");
}

for (let entity = 0; entity < MEDIUM_CAPACITY; entity++) {
  const e = asEntity(entity);
  componentManager.addInstanceToEntity(positionInstance, e, { x: entity, y: entity * 0.5 });
  if ((entity & 1) === 0) {
    componentManager.addInstanceToEntity(velocityInstance, e, { x: 1, y: -1 });
  }
  if (entity % 4 === 0) {
    componentManager.addInstanceToEntity(renderableInstance, e);
  }
  if (entity % 64 === 0) {
    componentManager.addInstanceToEntity(sleepingInstance, e);
  }
}

const entityManager = new EntityManager(MEDIUM_CAPACITY);
for (let i = 0; i < MEDIUM_CAPACITY; i++) {
  const entity = entityManager.create();
  if (entity === undefined) throw new Error("internal benchmark exhausted entity manager");
}

const recycleEntityManager = new EntityManager(SMALL_CAPACITY);
const activeIteratorIndices = new Uint32Array(SMALL_CAPACITY);
for (let i = 0; i < SMALL_CAPACITY; i++) {
  activeIteratorIndices[i] = i;
}
const reusableIterator = new ReusableEntityIterator(activeIteratorIndices).reset(SMALL_CAPACITY);
const entityIteratorPool = new EntityIteratorPool();

const componentCount = components.all.length;
const movementQueryInstance = createQueryInstance(
  componentCount,
  [positionInstance, velocityInstance],
  [],
  [sleepingInstance],
);
const renderableQueryInstance = createQueryInstance(
  componentCount,
  [positionInstance],
  [renderableInstance],
  [sleepingInstance],
);

const archetypeBitfield = bitfieldFor(componentCount, positionInstance, velocityInstance);
const movementArchetype = new Archetype(SMALL_CAPACITY, [positionInstance, velocityInstance], archetypeBitfield);
for (let entity = 0; entity < SMALL_CAPACITY; entity++) {
  movementArchetype.addEntity(asEntity(entity));
}

const archetypeResult = new QueryEntityResult(SMALL_CAPACITY);
const visitedEntities = new BooleanArray(SMALL_CAPACITY);
const transitionArchetype = new Archetype(
  SMALL_CAPACITY,
  [positionInstance, velocityInstance],
  bitfieldFor(componentCount, positionInstance, velocityInstance),
);

const archetypeManager = new ArchetypeManager(SMALL_CAPACITY, componentCount);
archetypeManager.init();
const archetypeQueryList = {
  queries: [movementQueryInstance, renderableQueryInstance],
  count: 2,
};
for (let entity = 0; entity < SMALL_CAPACITY; entity++) {
  const e = asEntity(entity);
  archetypeManager.addComponent(e, positionInstance);
  if ((entity & 1) === 0) archetypeManager.addComponent(e, velocityInstance);
  if (entity % 4 === 0) archetypeManager.addComponent(e, renderableInstance);
  if (entity % 64 === 0) archetypeManager.addComponent(e, sleepingInstance);
}
archetypeManager.refresh(archetypeQueryList);

const queryResult = new QueryEntityResult(MEDIUM_CAPACITY);
for (let i = 0; i < MEDIUM_CAPACITY; i++) {
  queryResult.add(asEntity(i), asSlotIndex(i));
}

const bulkTransitionEntities = new Uint32Array(SMALL_CAPACITY);
for (let i = 0; i < SMALL_CAPACITY; i++) {
  bulkTransitionEntities[i] = i;
}

const cachedQuery = new Query({ all: [components.position, components.velocity], none: [components.sleeping] });
const queryManager = new QueryManager(
  {
    getInstances: (definitions) => componentManager.getInstances(definitions),
    componentCount,
    isInitialized: () => true,
  },
  MEDIUM_CAPACITY,
  (queries) => archetypeManager.ensureQueryMembership(queries),
  (query) => archetypeManager.registerQuery(query),
  archetypeManager.clock,
);
queryManager.entityList(cachedQuery);

const dataEntity = asEntity(128);
const transitionEntity = asEntity(257);
const setData = { x: 1, y: -1 };
const addData = { x: 2, y: -2 };

function bitfieldFor(size: number, ...instances: DynamicComponentInstance[]): BooleanArray {
  const bitfield = new BooleanArray(size);
  for (let i = 0; i < instances.length; i++) {
    bitfield.set(instances[i]!.id, true);
  }
  return bitfield;
}

function createQueryInstance(
  size: number,
  all: DynamicComponentInstance[],
  any: DynamicComponentInstance[],
  none: DynamicComponentInstance[],
): QueryInstance {
  const componentsByName: Record<string, DynamicComponentInstance> = {};
  for (let i = 0; i < all.length; i++) {
    const instance = all[i]!;
    componentsByName[instance.name] = instance;
  }
  for (let i = 0; i < any.length; i++) {
    const instance = any[i]!;
    componentsByName[instance.name] = instance;
  }
  const and = bitfieldFor(size, ...all);
  const or = bitfieldFor(size, ...any);
  const not = bitfieldFor(size, ...none);
  const include = new BooleanArray(size);
  return {
    and,
    or,
    not,
    include,
    archetypes: new Array(),
    archetypeCount: 0,
    components: Object.freeze(componentsByName),
    id: `${and.toString()}:${or.toString()}:${not.toString()}:${include.toString()}`,
    resultStamp: -1,
    resultEpoch: -1,
    listStamp: 0,
  };
}

Deno.bench({
  name: "EntityManager constructor - 8K capacity",
  group: "internal entity manager",
  baseline: true,
  fn: () => {
    objectSink = new EntityManager(MEDIUM_CAPACITY);
  },
});

Deno.bench({
  name: "EntityManager create/destroy recycled id",
  group: "internal entity manager",
  fn: () => {
    const entity = recycleEntityManager.create();
    if (entity === undefined) throw new Error("recycle entity manager unexpectedly full");
    recycleEntityManager.destroy(entity);
    entitySink ^= entity;
  },
});

Deno.bench({
  name: "EntityManager isActive hot check",
  group: "internal entity manager",
  fn: () => {
    numericSink ^= entityManager.isActive(asEntity(512)) ? 1 : 0;
  },
});

Deno.bench({
  name: "EntityManager getActive dense iterator",
  group: "internal entity manager",
  fn: () => {
    let count = 0;
    for (const entity of entityManager.getActive()) {
      count += entity & 1;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "ReusableEntityIterator next over 1K ids",
  group: "internal entity manager",
  fn: () => {
    reusableIterator.reset(SMALL_CAPACITY);
    let count = 0;
    for (let next = reusableIterator.next(); !next.done; next = reusableIterator.next()) {
      count += next.value & 1;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "ComponentManager constructor - 8K / 12 components",
  group: "internal component manager",
  baseline: true,
  fn: () => {
    objectSink = new ComponentManager(MEDIUM_CAPACITY, createBenchmarkComponents().all);
  },
});

Deno.bench({
  name: "ComponentManager getInstance by component",
  group: "internal component manager",
  fn: () => {
    objectSink = componentManager.getInstance(components.position);
  },
});

Deno.bench({
  name: "ComponentManager getInstance by name",
  group: "internal component manager",
  fn: () => {
    objectSink = componentManager.getInstance("position");
  },
});

Deno.bench({
  name: "ComponentManager add/remove tag instance",
  group: "internal component manager",
  fn: () => {
    componentManager.addInstanceToEntity(renderableInstance, transitionEntity);
    componentManager.removeInstanceFromEntity(renderableInstance, transitionEntity);
  },
});

Deno.bench({
  name: "ComponentManager add/remove data instance",
  group: "internal component manager",
  fn: () => {
    componentManager.addInstanceToEntity(accelerationInstance, transitionEntity, addData);
    componentManager.removeInstanceFromEntity(accelerationInstance, transitionEntity);
  },
});

Deno.bench({
  name: "ComponentManager setInstanceEntityData",
  group: "internal component manager",
  fn: () => {
    setData.x = numericSink++;
    setData.y = -numericSink;
    componentManager.setInstanceEntityData(positionInstance, dataEntity, setData);
  },
});

Deno.bench({
  name: "ComponentManager getInstanceEntityData",
  group: "internal component manager",
  fn: () => {
    objectSink = componentManager.getInstanceEntityData(positionInstance, dataEntity);
  },
});

Deno.bench({
  name: "ComponentManager getOwners iterator",
  group: "internal component manager",
  fn: () => {
    let count = 0;
    const owners = componentManager.getOwners(components.position);
    if (owners !== undefined) {
      for (const entity of owners) count += entity & 1;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "ComponentManager getChanged dense iterator",
  group: "internal component manager",
  fn: () => {
    let count = 0;
    const changed = componentManager.getChanged(components.position);
    if (changed !== undefined) {
      for (const entity of changed) count += entity & 1;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "ComponentManager refresh changed flags",
  group: "internal component manager",
  fn: () => {
    componentManager.refresh();
  },
});

Deno.bench({
  name: "Archetype constructor - two component bitfield",
  group: "internal archetypes",
  baseline: true,
  fn: () => {
    objectSink = new Archetype(
      SMALL_CAPACITY,
      [positionInstance, velocityInstance],
      bitfieldFor(componentCount, positionInstance, velocityInstance),
    );
  },
});

Deno.bench({
  name: "Archetype add/remove entity bookkeeping",
  group: "internal archetypes",
  fn: () => {
    transitionArchetype.addEntity(asEntity(17));
    transitionArchetype.removeEntity(asEntity(17));
  },
});

Deno.bench({
  name: "Archetype writeEntitiesIntoResult",
  group: "internal archetypes",
  fn: () => {
    archetypeResult.clear();
    movementArchetype.writeEntitiesIntoResult(archetypeResult);
    entitySink ^= archetypeResult.count;
  },
});

Deno.bench({
  name: "Archetype writeEntitiesIntoResult with dedupe",
  group: "internal archetypes",
  fn: () => {
    archetypeResult.clear();
    visitedEntities.clear();
    movementArchetype.writeEntitiesIntoResult(archetypeResult, visitedEntities);
    entitySink ^= archetypeResult.count;
    visitedEntities.clear();
  },
});

Deno.bench({
  name: "Archetype isCandidate cached query",
  group: "internal archetypes",
  fn: () => {
    numericSink ^= movementArchetype.isCandidate(movementQueryInstance) ? 1 : 0;
  },
});

Deno.bench({
  name: "ArchetypeManager add/remove component transition",
  group: "internal archetype manager",
  baseline: true,
  fn: () => {
    archetypeManager.addComponent(asEntity(3), accelerationInstance);
    archetypeManager.removeComponent(asEntity(3), accelerationInstance);
  },
});

Deno.bench({
  name: "ArchetypeManager bulk add/remove component transition - 1K entities",
  group: "internal archetype manager",
  fn: () => {
    archetypeManager.addComponents(bulkTransitionEntities, SMALL_CAPACITY, accelerationInstance);
    archetypeManager.removeComponents(bulkTransitionEntities, SMALL_CAPACITY, accelerationInstance);
  },
});

Deno.bench({
  name: "ArchetypeManager registerQuery",
  group: "internal archetype manager",
  fn: () => {
    archetypeManager.registerQuery(movementQueryInstance);
  },
});

Deno.bench({
  name: "ArchetypeManager refresh query membership",
  group: "internal archetype manager",
  fn: () => {
    archetypeManager.refresh(archetypeQueryList);
  },
});

Deno.bench({
  name: "QueryEntityResult add 8K ids",
  group: "internal query cache",
  baseline: true,
  fn: () => {
    queryResult.clear();
    for (let i = 0; i < MEDIUM_CAPACITY; i++) {
      queryResult.add(asEntity(i), asSlotIndex(i));
    }
    entitySink ^= queryResult.count;
  },
});

Deno.bench({
  name: "QueryEntityResult pooled iterator over 8K ids",
  group: "internal query cache",
  fn: () => {
    let count = 0;
    for (const entity of entityIteratorPool.acquire().open(queryResult.entityBuffer, queryResult.count)) {
      count += entity & 1;
    }
    entitySink ^= count;
  },
});

Deno.bench({
  name: "QueryManager components hit",
  group: "internal query cache",
  fn: () => {
    objectSink = queryManager.components(cachedQuery);
  },
});

Deno.bench({
  name: "QueryManager entities hit",
  group: "internal query cache",
  fn: () => {
    entitySink ^= queryManager.entityList(cachedQuery).count;
  },
});

Deno.bench({
  name: "QueryManager invalidate and refill retained result",
  group: "internal query cache",
  fn: () => {
    queryManager.invalidate();
    entitySink ^= queryManager.entityList(cachedQuery).count;
  },
});

if (entitySink === Number.MIN_SAFE_INTEGER || numericSink === Number.MIN_SAFE_INTEGER || objectSink === null) {
  throw new Error("unreachable internal benchmark sink");
}
