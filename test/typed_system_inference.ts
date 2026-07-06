/**
 * Compile-only type inference checks. Included in `deno task check`, not `deno test`.
 * See test/README.md.
 */
import { Component, Query, System, World } from "../mod.ts";
import type {
  BorrowedEntityList,
  ComponentData,
  ComponentInstance,
  DynamicComponentInstance,
  Entity,
  QuerySpec,
  SchemaOrNull,
  SystemCallback,
  SystemInstance,
} from "../mod.ts";
import { tagComponent, type Vec2, vec2Component } from "./fixtures.ts";
// @ts-expect-error AnySystemCallback is not exported from the public mod.ts surface.
import type { AnySystemCallback } from "../mod.ts";

function expectType<T>(_value: T): void {}

const position = vec2Component();
const velocity = vec2Component("velocity");
const renderable = tagComponent("renderable");
const disabled = tagComponent("disabled");
const inferredTag = new Component({ name: "inferredTag" });

const world = new World({ capacity: 8, components: [position, velocity, renderable, disabled] });

const manualTypedQuery = new Query({
  all: { position, velocity },
  any: { renderable },
  none: { disabled },
});
const manualTypedSystem = new System({
  name: "manualTypedMovement",
  query: manualTypedQuery,
  callback: (components, entities, dt: number): void => {
    expectType<ComponentInstance<Vec2>>(components.position);
    expectType<ComponentInstance<Vec2>>(components.velocity);
    expectType<ComponentInstance<null>>(components.renderable);
    expectType<BorrowedEntityList>(entities);
    entities.indices[0];
    expectType<number>(dt);

    components.position.partitions.x;
    components.velocity.proxy?.x;

    // @ts-expect-error none components are query filters, not callback components.
    components.disabled;
    // @ts-expect-error misspelled component keys are rejected.
    components.postion;
  },
});
const manualTypedInstance = world.systems.create(manualTypedSystem);
manualTypedInstance(1 / 60);
// @ts-expect-error system instance arguments are inferred from the callback.
manualTypedInstance("fast");

const stringPosition = world.components.getInstance("position");
expectType<DynamicComponentInstance | undefined>(stringPosition);
// @ts-expect-error string component lookup returns a dynamic component instance, not a concrete schema.
expectType<ComponentInstance<Vec2> | undefined>(stringPosition);

const requiredStringPosition = world.components.require("position");
expectType<DynamicComponentInstance>(requiredStringPosition);
// @ts-expect-error required string lookup still cannot recover a concrete schema.
expectType<ComponentInstance<Vec2>>(requiredStringPosition);

const stringReadPosition = world.components.readEntityData("position", 0 as Entity);
expectType<ComponentData<SchemaOrNull> | undefined>(stringReadPosition);
// @ts-expect-error string component lookup cannot infer a schema for data reads.
world.components.readEntityData<Vec2>("position", 0 as Entity);
// @ts-expect-error string component lookup cannot infer a schema for throwing data reads.
world.components.getEntityData<Vec2>("position", 0 as Entity);

const namedSystem = world.systems.get("manualTypedMovement");
expectType<SystemInstance<SystemCallback> | undefined>(namedSystem);

// @ts-expect-error string component lookup cannot infer a schema for data writes.
world.components.addToEntity("position", 0 as Entity, { x: 1, y: 2 });
// @ts-expect-error string component lookup cannot infer a schema for batch data writes.
world.components.addToEntities("position", { count: 0, indices: [] }, { x: 1, y: 2 });
// @ts-expect-error tag components do not accept data payloads.
world.components.addToEntity(renderable, 0 as Entity, {});
// @ts-expect-error tag components do not have settable component data.
world.components.setEntityData(renderable, 0 as Entity, {});

const asyncSystem = new System({
  name: "asyncMovement",
  query: new Query({ all: { position } }),
  callback: async (components): Promise<void> => {
    await Promise.resolve();
    expectType<ComponentInstance<Vec2>>(components.position);
  },
});

const asyncInstance = world.systems.create(asyncSystem);
expectType<Promise<void>>(asyncInstance());

const querySpec: QuerySpec = {
  all: [position],
  any: [renderable],
  none: [disabled],
};
const dynamicQuery = new Query(querySpec);
const compatibilityCallback: SystemCallback = (components, entities, label) => {
  const dynamicPosition = components["position"];
  if (!dynamicPosition) return;
  expectType<ComponentInstance<SchemaOrNull>>(dynamicPosition);
  expectType<BorrowedEntityList>(entities);
  entities.indices[0];
  expectType<unknown>(label);

  // @ts-expect-error dynamic compatibility callbacks do not expose concrete schema properties without narrowing.
  dynamicPosition.storage?.partitions.x;

  const positionInstance = dynamicPosition as ComponentInstance<Vec2>;
  positionInstance.storage?.partitions.x;
};

const dynamicSystem = new System({
  name: "dynamicMovement",
  query: dynamicQuery,
  callback: compatibilityCallback,
});

const dynamicWorld = new World({ capacity: 8, components: [position, renderable, disabled, inferredTag] });
const dynamicInstance = dynamicWorld.systems.create(dynamicSystem);
dynamicInstance("label");

// -- Partition typing: constructor-shaped generics resolve exact typed arrays,
// dual-shape generics keep branded writes while exposing exact storage partitions.
type GridPosValues = { x: number; y: number };
type GridPosStorage = { x: Int16ArrayConstructor; y: Int16ArrayConstructor };
type FacingValues = { dir: 0 | 1 | 2 | 3 };
type FacingStorage = { dir: Uint8ArrayConstructor };
const gridPos = new Component<GridPosValues, GridPosStorage>({
  name: "gridPos",
  schema: { x: Int16Array, y: Int16Array },
});
const facing = new Component<FacingValues, FacingStorage>({ name: "facing", schema: { dir: Uint8Array } });
const health = new Component<{ hp: number }, { hp: Uint16ArrayConstructor }>({
  name: "health",
  schema: { hp: Uint16Array },
});

const valueShapedQuery = new Query({ all: { gridPos, facing } });
const valueShapedSystem = new System({
  name: "valueShapedMovement",
  query: valueShapedQuery,
  callback: (components, _entities): void => {
    expectType<Int16Array>(components.gridPos.partitions.x);
    expectType<Uint8Array>(components.facing.partitions.dir);
    // @ts-expect-error data component partitions are never null.
    expectType<null>(components.gridPos.partitions);
  },
});
void valueShapedSystem;

const ctorShapedSystem = new System({
  name: "ctorShapedMovement",
  query: new Query({ all: { position } }),
  callback: (components, entities): void => {
    expectType<Float32Array>(components.position.partitions.x);
    // Entity lists are iterable for convenience paths.
    for (const entity of entities) {
      expectType<Entity>(entity);
    }
  },
});
void ctorShapedSystem;

// -- Branded write types: value-shaped keys enforce their declared value type.
const brandedWorld = new World({ capacity: 8, components: [gridPos, facing] });
const brandedEntity = brandedWorld.entities.createOrThrow();
expectType<Entity>(brandedEntity);

brandedWorld.components.addToEntity(facing, brandedEntity, { dir: 2 });
// @ts-expect-error 7 is not a valid FacingValues["dir"] literal.
brandedWorld.components.addToEntity(facing, brandedEntity, { dir: 7 });
brandedWorld.components.addBundle(brandedEntity, [[facing, { dir: 1 }]]);
// @ts-expect-error 7 is not a valid FacingValues["dir"] literal in bundles.
brandedWorld.components.addBundle(brandedEntity, [[facing, { dir: 7 }]]);
// @ts-expect-error tag bundle entries do not accept data.
brandedWorld.components.addBundle(brandedEntity, [[renderable, {}]]);

// Partial writes: omitted keys are allowed.
brandedWorld.components.setEntityData(gridPos, brandedEntity, { x: 4 });
brandedWorld.components.addToEntity(gridPos, brandedEntity, { y: 2 });
// @ts-expect-error unknown keys are rejected.
brandedWorld.components.setEntityData(gridPos, brandedEntity, { z: 4 });

// Constructor-shaped keys accept any number when writing.
brandedWorld.components.setEntityData(position, brandedEntity, { x: 1.5 });

// -- Non-throwing reads preserve the schema keys and add undefined.
const readResult = brandedWorld.components.readEntityData(gridPos, brandedEntity);
expectType<Record<"x" | "y", number> | undefined>(readResult);
// @ts-expect-error readEntityData results must be narrowed before property access.
readResult.x;

const readOut = { x: 0, y: 0, label: "kept" };
expectType<boolean>(brandedWorld.components.readEntityDataInto(gridPos, brandedEntity, readOut));

const includeQuery = new Query({
  all: { gridPos },
  include: { facing, health },
  none: { disabled },
});
const includeSystem = new System({
  name: "includeRender",
  query: includeQuery,
  callback: (components): void => {
    expectType<ComponentInstance<GridPosValues, GridPosStorage>>(components.gridPos);
    expectType<ComponentInstance<FacingValues, FacingStorage>>(components.facing);
    expectType<ComponentInstance<{ hp: number }, { hp: Uint16ArrayConstructor }>>(components.health);
    // @ts-expect-error none components are filters, not callback components.
    components.disabled;
  },
});
void includeSystem;

const composedWithInclude = Query.compose([
  new Query({ all: { gridPos }, include: { facing } }),
  new Query({ all: { renderable }, include: { health } }),
]);
const composedSystem = new System({
  name: "composedInclude",
  query: composedWithInclude,
  callback: (components): void => {
    expectType<ComponentInstance<GridPosValues, GridPosStorage>>(components.gridPos);
    expectType<ComponentInstance<null>>(components.renderable);
    expectType<ComponentInstance<FacingValues, FacingStorage>>(components.facing);
    expectType<ComponentInstance<{ hp: number }, { hp: Uint16ArrayConstructor }>>(components.health);
  },
});
void composedSystem;

const plainAnnotatedQuery: Query = new Query({ all: { gridPos }, include: { facing } });
const plainAnnotatedSystem = new System({
  name: "plainAnnotated",
  query: plainAnnotatedQuery,
  callback: (components): void => {
    const dynamicFacing = components["facing"];
    if (!dynamicFacing) return;
    expectType<ComponentInstance<SchemaOrNull, SchemaOrNull>>(dynamicFacing);
    // @ts-expect-error plain Query annotations intentionally erase concrete include inference.
    dynamicFacing.partitions.dir;
  },
});
void plainAnnotatedSystem;
