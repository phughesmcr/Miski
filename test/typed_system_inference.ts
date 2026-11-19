/**
 * Compile-only type inference checks. Included in `deno task check`, not `deno test`.
 * See test/README.md.
 */
import { Component, defineComponentSchema, entityIndex, Query, Schedule, System, World } from "../mod.ts";
import type {
  BorrowedEntityList,
  ComponentData,
  ComponentInstance,
  ComponentSchema,
  DynamicComponentInstance,
  Entity,
  QuerySpec,
  ScheduleContext,
  SchemaOrNull,
  SystemArgCount,
  SystemCallback,
  SystemInstance,
  UntypedQueryComponents,
} from "../mod.ts";
import { tagComponent, type Vec2, vec2Component, vec2Schema } from "./fixtures.ts";
// @ts-expect-error AnySystemCallback is not exported from the public mod.ts surface.
import type { AnySystemCallback } from "../mod.ts";

function expectType<T>(_value: T): void {}

const position = vec2Component();
const velocity = vec2Component("velocity");
const renderable = tagComponent("renderable");
const disabled = tagComponent("disabled");
const inferredTag = new Component({ name: "inferredTag" });
const inferredPosition = new Component({
  name: "inferredPosition",
  schema: { x: Float32Array, y: Float32Array },
});
expectType<Component<null, null>>(inferredTag);
expectType<Component<Vec2, Vec2>>(inferredPosition);
// @ts-expect-error bare schema components are not tags
expectType<Component<null>>(inferredPosition);

// ComponentSchema / defineComponentSchema: name storage without *Constructor aliases
type Vec2FromHelper = ComponentSchema<typeof vec2Schema>;
expectType<Vec2>(null as unknown as Vec2FromHelper);
const reusedSchemaPosition = new Component({ name: "reusedSchemaPosition", schema: vec2Schema });
expectType<Component<Vec2, Vec2>>(reusedSchemaPosition);
const intGrid = defineComponentSchema({ x: Int16Array, y: Int16Array });
type IntGrid = ComponentSchema<typeof intGrid>;
expectType<Int16ArrayConstructor>((null as unknown as IntGrid)["x"]);
// @ts-expect-error schema helper preserves the chosen typed-array constructor
expectType<Float32ArrayConstructor>((null as unknown as IntGrid)["x"]);

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
    entities.slots[0];
    entities.each((_slot, _entity, _i) => {});
    expectType<number>(dt);

    components.position.partitions.x;
    components.velocity.proxy?.x;

    // @ts-expect-error none components are query filters, not callback components.
    components.disabled;
    // @ts-expect-error misspelled component keys are rejected.
    components.postion;
  },
});
const manualTypedInstance = world.systems.register(manualTypedSystem);
manualTypedInstance(1 / 60);
// @ts-expect-error system instance arguments are inferred from the callback.
manualTypedInstance("fast");

// -- Entity vs SlotIndex brands at function APIs (not TypedArray indexing).
{
  const entity = 0 as Entity;
  const slot = entityIndex(entity);
  const positionInstance = world.components.require(position);
  positionInstance.getAt(slot, "x");
  // @ts-expect-error packed handles are not storage slots.
  positionInstance.getAt(entity, "x");
  // @ts-expect-error slots are not packed entity handles.
  world.entities.destroy(slot);
  world.entities.isActive(entity);
}

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
world.components.addToEntities("position", { count: 0, entities: [], slots: [] }, { x: 1, y: 2 });
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

const asyncInstance = world.systems.register(asyncSystem);
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
  entities.slots[0];
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
const dynamicInstance = dynamicWorld.systems.register(dynamicSystem);
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

// argCount: optional, and must fit the callback's extra parameter count.
const argCountQuery = new Query({ all: { position } });
const fixedArgSystem = new System({
  name: "fixedArg",
  query: argCountQuery,
  argCount: 1,
  callback: (_components, _entities, dt: number): number => dt,
});
expectType<(dt: number) => number>(world.systems.register(fixedArgSystem));
const optionalArgSystem = new System({
  name: "optionalArg",
  query: argCountQuery,
  argCount: 2,
  callback: (_components, _entities, dt: number, scale?: number): void => void [dt, scale],
});
void optionalArgSystem;
const noArgSystem = new System({
  name: "noArg",
  query: argCountQuery,
  argCount: 0,
  callback: (): void => {},
});
void noArgSystem;
const tooManyArgSystem = new System({
  name: "tooManyArg",
  query: argCountQuery,
  // @ts-expect-error argCount must match the callback's extra parameter count.
  argCount: 2,
  callback: (_components, _entities, dt: number): void => void dt,
});
void tooManyArgSystem;
const untypedArgSystem = new System<UntypedQueryComponents, unknown[], void>({
  name: "untypedArg",
  query: new Query({ all: [position] }),
  // @ts-expect-error argCount is limited to 0..4.
  argCount: 5,
  callback: (): void => {},
});
void untypedArgSystem;

// Scheduled systems: argCount is optional for Schedule.add (the context is still forwarded), limited to the
// callback's arity, and SystemArgCount is the 0..4 union.
{
  const world = new World({ capacity: 8, components: [renderable] });
  const schedule = new Schedule(world);
  const query = new Query({ all: [renderable] });
  const withoutArgCount = new System<Record<string, never>, [ScheduleContext], void>({
    name: "withoutArgCount",
    query,
    callback: (_components, _entities, _ctx) => {},
  });
  schedule.add(withoutArgCount);
  schedule.add(new System({ name: "fixed", query, argCount: 1, callback: (_c, _e, _ctx: ScheduleContext) => {} }));
  new System<Record<string, never>, [ScheduleContext], void>({
    name: "tooMany",
    query,
    // @ts-expect-error argCount cannot exceed the callback's extra parameters
    argCount: 2,
    callback: (_components, _entities, _ctx) => {},
  });
  const twoArgs = new System({ name: "twoArgs", query, argCount: 2, callback: (_c, _e, _a: number, _b: number) => {} });
  // @ts-expect-error a scheduled system receives only the context
  schedule.add(twoArgs);
  expectType<0 | 1 | 2 | 3 | 4>(null! as SystemArgCount);
  expectType<SystemArgCount>(4);
  // @ts-expect-error 5 is not a SystemArgCount
  expectType<SystemArgCount>(5);
  const enabled: boolean = schedule.setEnabled("fixed", false);
  void enabled;
  const destroyed: Promise<boolean> = world.systems.destroy("fixed");
  const destroyedOrThrow: Promise<void> = world.systems.destroyOrThrow("fixed");
  void destroyed;
  void destroyedOrThrow;
}
