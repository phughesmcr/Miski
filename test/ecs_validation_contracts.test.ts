/// <reference lib="deno.ns" />

import { AlreadyRegisteredError, Component, defineSystem, Query, SpecError, System, World } from "../mod.ts";
import { NoComponentsFoundError } from "../src/errors.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";

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
  for (let capacity = 1; capacity < 8; capacity++) {
    assertThrows(
      () => new World({ capacity, components: [position] }),
      SpecError,
      "Invalid WorldSpec",
    );
  }
  new World({ capacity: 8, components: [position] });
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
    () => new Query({ all: [position], any: [position] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ any: [position], none: [position] }),
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

Deno.test("world capacity validation does not expose storage-layer errors", () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });

  assertThrows(
    () => new World({ capacity: 7, components: [position] }),
    SpecError,
    "Invalid WorldSpec",
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

Deno.test("defineSystem with no component maps fails through existing system creation validation", async () => {
  const disabled = new Component<null>({ name: "disabled" });
  const world = new World({ capacity: 8, components: [disabled] });
  await world.init();

  assertThrows(
    () =>
      world.systems.create(
        defineSystem({
          name: "emptyTypedSystem",
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

Deno.test("world specifications reject duplicate component names", () => {
  const first = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const second = new Component<null>({ name: "position" });

  assertThrows(
    () => new World({ capacity: 8, components: [first, second] }),
    SpecError,
    "Invalid WorldSpec",
  );
  assertThrows(
    () => new World({ capacity: 8, components: [first, first] }),
    SpecError,
    "Invalid WorldSpec",
  );
});

Deno.test("component registry exposes a frozen snapshot without backing lookup mutation", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const registered = world.components.getInstance("position");
  assert(Object.isFrozen(world.components.registry), "Expected public component registry to be frozen");

  try {
    (world.components.registry as Record<string, unknown>)["position"] = undefined;
  } catch {
    // Frozen objects throw in strict mode; either throw or no-op is acceptable.
  }
  try {
    delete (world.components.registry as Record<string, unknown>)["position"];
  } catch {
    // Frozen objects throw in strict mode; either throw or no-op is acceptable.
  }

  assert(world.components.isRegistered("position"), "Expected string lookup to survive registry mutation attempt");
  assert(world.components.getInstance("position") === registered, "Expected string lookup to retain original instance");

  const entity = world.entities.create();
  assert(entity !== undefined, "Expected entity creation to succeed");
  world.components.addToEntity(position, entity, { x: 1, y: 2 });
  assertEquals([...world.entities.query(new Query({ all: [position] }))], [entity], "Expected query to still work");
});

Deno.test("system registry exposes a frozen live view without backing lookup mutation", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();
  const movement = new System({
    name: "movement",
    query: new Query({ all: [position] }),
    callback: () => {},
  });

  assert(Object.isFrozen(world.systems.registry), "Expected initial public system registry to be frozen");
  const instance = world.systems.create(movement);
  assert(Object.isFrozen(world.systems.registry), "Expected updated public system registry to be frozen");
  assert(world.systems.registry["movement"] === instance, "Expected created system to appear in public registry");

  try {
    (world.systems.registry as Record<string, unknown>)["movement"] = undefined;
  } catch {
    // Frozen objects throw in strict mode; either throw or no-op is acceptable.
  }
  try {
    delete (world.systems.registry as Record<string, unknown>)["movement"];
  } catch {
    // Frozen objects throw in strict mode; either throw or no-op is acceptable.
  }

  assert(world.systems.has(movement), "Expected system lookup to survive registry mutation attempt");
  assert(world.systems.get("movement") === instance, "Expected string lookup to retain original system instance");

  await world.systems.destroy(movement);
  assert(Object.isFrozen(world.systems.registry), "Expected post-destroy public system registry to be frozen");
  assert(
    world.systems.registry["movement"] === undefined,
    "Expected destroyed system to disappear from public registry",
  );
  assert(world.systems.has(movement) === false, "Expected destroyed system to be absent from internal lookup");
});

Deno.test("duplicate system names are rejected explicitly", async () => {
  const position = new Component<Vec2>({ name: "position", schema: { x: Float32Array, y: Float32Array } });
  const world = new World({ capacity: 8, components: [position] });
  await world.init();

  const first = new System({
    name: "movement",
    query: new Query({ all: [position] }),
    callback: () => {},
  });
  const second = new System({
    name: "movement",
    query: new Query({ all: [position] }),
    callback: () => {},
  });

  world.systems.create(first);
  assertThrows(
    () => world.systems.create(second),
    AlreadyRegisteredError,
    'System "movement" is already registered',
  );
  assertThrows(
    () => world.systems.create(first),
    AlreadyRegisteredError,
    'System "movement" is already registered',
  );
});
