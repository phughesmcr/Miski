/// <reference lib="deno.ns" />
import {
  ArgumentError,
  CapacityError,
  compileComponentSchema,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  field,
  isMiskiError,
  MiskiError,
  Prefab,
  Relation,
  RelationCycleError,
  Schedule,
  SpecError,
} from "../mod.ts";
import { createEntity, createTestWorld, vec2Component } from "./fixtures.ts";
import { assert, assertStrictEquals } from "./helpers.ts";

/** Run `fn`, require it to throw `ErrorClass`, and require `isMiskiError` to accept what it threw. */
function assertMiskiThrows(fn: () => unknown, ErrorClass: typeof MiskiError, label: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown !== undefined, `${label}: expected a throw`);
  assert(isMiskiError(thrown), `${label}: isMiskiError should accept ${String(thrown)}`);
  assert(thrown instanceof ErrorClass, `${label}: expected ${ErrorClass.name}, got ${String(thrown)}`);
}

Deno.test("isMiskiError catches failures across the library", async () => {
  // Schema
  assertMiskiThrows(() => compileComponentSchema("nope" as never), SpecError, "schema not an object");
  assertMiskiThrows(
    () => compileComponentSchema({ a: { x: Float32Array } }, { a: true }),
    SpecError,
    "schema tag collision",
  );

  // Field
  assertMiskiThrows(() => field.enum([]), SpecError, "field.enum with no labels");
  assertMiskiThrows(() => field.object({ encode: (value: unknown) => value } as never), SpecError, "field.object half");

  // Prefab
  const position = vec2Component("position");
  assertMiskiThrows(() => new Prefab({ components: [[position], [position]] }), SpecError, "prefab duplicate");
  assertMiskiThrows(() => new Prefab({ components: [[position, 5 as never]] }), ComponentDataError, "prefab payload");

  // Component data and capacity
  const hero = new Component({ name: "hero", maxOwners: 1 });
  const linked = new Relation({ name: "linked", exclusive: true, acyclic: true, schema: { weight: Float32Array } });
  const world = await createTestWorld([position, hero, linked]);
  const a = createEntity(world);
  const b = createEntity(world);
  assertMiskiThrows(
    () => world.components.addToEntity(position, a, 5 as never),
    ComponentDataError,
    "component data not an object",
  );
  assertMiskiThrows(
    () => world.components.getInstanceOrThrow(hero).get(a, "x" as never),
    ComponentDataError,
    "tag has no data storage",
  );
  world.components.addToEntity(hero, a);
  assertMiskiThrows(() => world.components.addToEntity(hero, b), CapacityError, "owner cap");
  assertMiskiThrows(() => world.entities.create([[hero]]), CapacityError, "owner cap via plain create");
  assertMiskiThrows(() => world.entities.create([[position], [position]] as never), ArgumentError, "duplicate bundle");

  // Relation data and cycles
  world.relations.add(linked, a, b);
  assertMiskiThrows(() => world.relations.add(linked, b, a), RelationCycleError, "relation cycle");
  assertMiskiThrows(() => world.relations.setData(linked, a, b, 5 as never), ComponentDataError, "relation data");
  assertMiskiThrows(() => world.relations.setData(linked, b, a, { weight: 1 }), ComponentOwnershipError, "no pair");

  // Schedule
  const schedule = new Schedule(world);
  assertMiskiThrows(() => schedule.run(-1), ArgumentError, "schedule negative dt");
  assertMiskiThrows(() => schedule.setClock(null as never), ArgumentError, "schedule clock");

  await world.destroy();
});

Deno.test("new error classes carry their names and default messages", () => {
  const argument = new ArgumentError();
  assertStrictEquals(argument.name, "ArgumentError", "ArgumentError name");
  assertStrictEquals(argument.message, "Invalid argument", "ArgumentError default message");
  const cycle = new RelationCycleError();
  assertStrictEquals(cycle.name, "RelationCycleError", "RelationCycleError name");
  assert(isMiskiError(argument) && isMiskiError(cycle), "both are MiskiErrors");
});
