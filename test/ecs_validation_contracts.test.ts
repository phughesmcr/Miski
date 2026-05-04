/// <reference lib="deno.ns" />

import { Component, Query, SpecError, System, World } from "../mod.ts";
import { NoComponentsFoundError } from "../src/errors.ts";
import { assert, assertThrows } from "./helpers.ts";

type Vec2 = { x: Float32ArrayConstructor; y: Float32ArrayConstructor };

Deno.test("component, world, query, and system specifications reject invalid shapes", () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });

  assertThrows(
    () => new Component<null>({ name: "bad component name" }),
    TypeError,
    "Invalid component specification",
  );
  assertThrows(
    () => new Component<null>({ name: "player", maxEntities: 0 }),
    TypeError,
    "Invalid component specification",
  );
  assertThrows(
    () => new World({ capacity: 0, components: [position] }),
    SpecError,
    "Invalid WorldSpec",
  );
  assertThrows(
    () => new World({ capacity: 8, components: [] }),
    SpecError,
    "Invalid WorldSpec",
  );
  assertThrows(
    () => new Query({}),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ all: [position], none: [position] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () =>
      new System({
        name: "bad system name",
        query: new Query({ all: [position] }),
        callback: () => {},
      }),
    SpecError,
    "Invalid system specification",
  );
});

Deno.test("systems cannot be created for queries that expose no component instances", async () => {
  const disabled = new Component<null>({ name: "disabled" });
  const world = new World({ capacity: 8, components: [disabled] });
  await world.init();

  assertThrows(
    () =>
      world.systems.create(
        new System({
          name: "disabledSweep",
          query: new Query({ none: [disabled] }),
          callback: () => {},
        }),
      ),
    NoComponentsFoundError,
    "System query returned no components",
  );
});

Deno.test("component registry lookups by name and prototype stay consistent", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  assert(world.components.isRegistered(position), "Expected component prototype to be registered");
  assert(world.components.isRegistered("position"), "Expected component name to be registered");
  assert(
    world.components.getInstance(position) === world.components.getInstance("position"),
    "Expected name and prototype lookups to return the same instance",
  );
});
