/// <reference lib="deno.ns" />
import {
  CapacityError,
  compileComponentSchema,
  Component,
  componentSchemaHash,
  createEcsWorld,
  NotRegisteredError,
  SpecError,
} from "../mod.ts";
import { $_COMPONENT_ID_KEY } from "../src/constants.ts";
import { mergeComponentSchemas } from "../src/schema/schema.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

Deno.test("compileComponentSchema hash is stable for equivalent maps", () => {
  const left = compileComponentSchema({
    Health: { hp: Uint16Array, maxHp: Uint16Array },
    Position: { x: Float32Array, y: Float32Array },
  });
  const right = componentSchemaHash({
    Position: { y: Float32Array, x: Float32Array },
    Health: { maxHp: Uint16Array, hp: Uint16Array },
  });
  assertStrictEquals(left.schemaHash, right, "schema hash ignores key order");
});

Deno.test("compileComponentSchema hash includes tags and maxOwners", () => {
  const withPlayer = compileComponentSchema(
    { Position: { x: Float32Array, y: Float32Array } },
    { Player: true, Hero: { maxOwners: 1 } },
  );
  const reordered = componentSchemaHash(
    { Position: { x: Float32Array, y: Float32Array } },
    { Hero: { maxOwners: 1 }, Player: true },
  );
  assertStrictEquals(withPlayer.schemaHash, reordered, "tag key order does not change hash");

  const uncappedHero = componentSchemaHash(
    { Position: { x: Float32Array, y: Float32Array } },
    { Player: true, Hero: true },
  );
  assert(
    withPlayer.schemaHash !== uncappedHero,
    "maxOwners changes the schema hash",
  );

  const noTags = componentSchemaHash({ Position: { x: Float32Array, y: Float32Array } });
  assert(withPlayer.schemaHash !== noTags, "adding tags changes the schema hash");
  assertStrictEquals(withPlayer.tagMap.Player, true, "compiled tagMap preserves true");
  assertEquals(
    withPlayer.tagMap.Hero,
    { maxOwners: 1 },
    "compiled tagMap preserves maxOwners",
  );
});

Deno.test("schema hashing does not allocate component identities and merge preserves definitions", async () => {
  const before = new Component({ name: "before" })[$_COMPONENT_ID_KEY];
  const hash = componentSchemaHash({ position: { y: Float32Array, x: Float32Array } }, { hero: { maxOwners: 1 } });
  const after = new Component({ name: "after" })[$_COMPONENT_ID_KEY];
  assertStrictEquals(after, before + 1, "metadata hashing leaves the global component id unchanged");
  const left = compileComponentSchema({ position: { x: Float32Array, y: Float32Array } });
  const right = compileComponentSchema({}, { hero: { maxOwners: 1 } });
  const merged = mergeComponentSchemas(left, right);
  assertStrictEquals(merged.schemaHash, hash, "merge and direct hash use the same canonical ordering");
  assertStrictEquals(merged.components.position, left.components.position, "merge retains data definition identity");
  assertStrictEquals(merged.components.hero, right.components.hero, "merge retains tag definition identity");
  for (const map of [merged.componentMap, merged.tagMap, merged.components]) {
    assertStrictEquals(Object.getPrototypeOf(map), null, "schema registries have no inherited keys");
    assert(Object.isFrozen(map), "schema registries are frozen");
  }
  const ecs = createEcsWorld({ capacity: 8, schema: merged });
  await ecs.init();
  assertStrictEquals(ecs.components.position, left.components.position, "world keeps compiled component identities");
  ecs.spawn({ position: { x: 1 }, hero: true });
  assertThrows(() => ecs.spawn({ hero: true }), CapacityError, "can only be added to 1");
  assertThrows(() => ecs.spawn({ constructor: {} } as never), NotRegisteredError, "Unknown component");
  await ecs.world.destroy();

  const related = createEcsWorld({ capacity: 8, schema: merged, relations: { ChildOf: { exclusive: true } } });
  await related.init();
  assertStrictEquals(related.components.hero, right.components.hero, "schema worlds keep tag identities");
  const parent = related.spawnOrThrow({ position: { x: 0 } });
  const child = related.spawnOrThrow({ position: { x: 1 } });
  related.world.relations.add(related.relations.ChildOf, child, parent);
  assertStrictEquals(related.world.relations.getTarget(related.relations.ChildOf, child), parent, "schema + relations");
  await related.world.destroy();

  assertThrows(
    () => createEcsWorld({ capacity: 8, schema: merged, components: merged.componentMap } as never),
    SpecError,
    "either `schema` or `components`",
  );
});

Deno.test("plain schema bootstrap and hashing share validation", () => {
  for (const name of ["constructor", "__proto__", "toString", "\u00e9clair", "\u{1f680}"]) {
    const input = { [name]: { x: Float32Array } };
    assertThrows(() => componentSchemaHash(input), SpecError, "Invalid component specification");
    assertThrows(() => compileComponentSchema(input), SpecError, "Invalid component specification");
    assertThrows(
      () => createEcsWorld({ capacity: 8, components: input }),
      SpecError,
      "Invalid component specification",
    );
  }
  const ordered = compileComponentSchema({ apple: { x: Float32Array }, Zebra: { x: Float32Array } });
  assertEquals(ordered.entries.map((entry) => entry.name), ["Zebra", "apple"], "ordering uses code units, not locale");
  assertStrictEquals(
    ordered.schemaHash,
    componentSchemaHash({ Zebra: { x: Float32Array }, apple: { x: Float32Array } }),
    "ordering ignores authored order",
  );
  assertThrows(() => mergeComponentSchemas(ordered, ordered), SpecError, "duplicate names");
  assertThrows(() => componentSchemaHash({ position: { x: Float32Array } }, { position: true }), SpecError, "collides");
  for (const maxOwners of [0, -1, 1.5, Infinity]) {
    assertThrows(() => componentSchemaHash({}, { hero: { maxOwners } }), SpecError, "positive integer");
    assertThrows(
      () => createEcsWorld({ capacity: 8, components: {}, tags: { hero: { maxOwners } } }),
      SpecError,
      "positive integer",
    );
  }
});
