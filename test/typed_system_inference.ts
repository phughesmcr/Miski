import { Component, defineSystem, Query, System, World } from "../mod.ts";
import type { BorrowedEntityList, ComponentInstance, QuerySpec, SchemaOrNull, SystemCallback } from "../mod.ts";
// @ts-expect-error AnySystemCallback is not exported from the public mod.ts surface.
import type { AnySystemCallback } from "../mod.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

function expectType<T>(_value: T): void {}

const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
const renderable = new Component<null>({ name: "renderable" });
const disabled = new Component<null>({ name: "disabled" });
const inferredTag = new Component({ name: "inferredTag" });

const movement = defineSystem({
  name: "movement",
  all: { position, velocity },
  any: { renderable },
  none: { disabled },
  callback: (components, entities, dt: number): void => {
    expectType<ComponentInstance<Vec2>>(components.position);
    expectType<ComponentInstance<Vec2>>(components.velocity);
    expectType<ComponentInstance<null>>(components.renderable);
    expectType<BorrowedEntityList>(entities);
    entities.indices[0];
    expectType<number>(dt);

    components.position.storage?.partitions.x;
    components.velocity.proxy?.x;

    // @ts-expect-error none components are query filters, not callback components.
    components.disabled;
    // @ts-expect-error misspelled component keys are rejected.
    components.postion;
  },
});

const world = new World({ capacity: 8, components: [position, velocity, renderable, disabled] });
const movementInstance = world.systems.create(movement);
movementInstance(1 / 60);
// @ts-expect-error system instance arguments are inferred from the callback.
movementInstance("fast");

const asyncSystem = defineSystem({
  name: "asyncMovement",
  all: { position },
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
