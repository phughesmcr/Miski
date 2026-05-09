import { Component, defineSystem, World } from "../mod.ts";
import type { ComponentInstance } from "../mod.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

function expectType<T>(_value: T): void {}

const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });
const renderable = new Component<null>({ name: "renderable" });
const disabled = new Component<null>({ name: "disabled" });

const movement = defineSystem({
  name: "movement",
  all: { position, velocity },
  any: { renderable },
  none: { disabled },
  callback: (components, entities, dt: number): void => {
    expectType<ComponentInstance<Vec2>>(components.position);
    expectType<ComponentInstance<Vec2>>(components.velocity);
    expectType<ComponentInstance<null>>(components.renderable);
    entities.next();
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
