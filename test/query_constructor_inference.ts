import { Component, Query, System } from "../mod.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
const velocity = new Component<Vec2>({ name: "velocity", schema: { x: Float32Array, y: Float32Array } });

const movement = new System({
  name: "movement",
  query: new Query({ all: { position, velocity } }),
  callback: (components) => {
    components.position.partitions.x;
    // @ts-expect-error misspelled keys are rejected
    components.postion;
  },
});

const untyped = new Query({ all: [position, velocity] });
const dynamic = new System({
  name: "dynamic",
  query: untyped,
  callback: (components) => {
    const position = components["position"];
    if (position) {
      // @ts-expect-error dynamic queries do not expose concrete schema properties without narrowing.
      position.storage?.partitions.x;
    }
    // @ts-expect-error dynamic queries do not expose keyed schema properties
    components.position;
  },
});

void movement;
void dynamic;
