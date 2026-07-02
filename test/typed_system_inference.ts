/**
 * Compile-only type inference checks. Included in `deno task check`, not `deno test`.
 * See test/README.md.
 */
import { Component, Query, System, World } from "../mod.ts";
import type {
  BorrowedEntityList,
  ComponentInstance,
  Entity,
  QuerySpec,
  SchemaOrNull,
  SystemCallback,
  TypedArray,
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
// value-shaped generics (as documented in mod.ts) resolve the general TypedArray.
type GridPosValues = { x: number; y: number };
type FacingValues = { dir: 0 | 1 | 2 | 3 };
const gridPos = new Component<GridPosValues>({ name: "gridPos", schema: { x: Int16Array, y: Int16Array } });
const facing = new Component<FacingValues>({ name: "facing", schema: { dir: Uint8Array } });

const valueShapedQuery = new Query({ all: { gridPos, facing } });
const valueShapedSystem = new System({
  name: "valueShapedMovement",
  query: valueShapedQuery,
  callback: (components, _entities): void => {
    expectType<TypedArray>(components.gridPos.partitions.x);
    expectType<TypedArray>(components.facing.partitions.dir);
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
