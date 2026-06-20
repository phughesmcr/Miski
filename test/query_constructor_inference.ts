/**
 * Compile-only type inference checks. Included in `deno task check`, not `deno test`.
 * See test/README.md.
 */
import { Query, System } from "../mod.ts";
import { vec2Component } from "./fixtures.ts";

const position = vec2Component();
const velocity = vec2Component("velocity");

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
