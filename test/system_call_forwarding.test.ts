/// <reference lib="deno.ns" />

import { Query, System, type World } from "../mod.ts";
import { createEntity, createTestWorld, tagComponent } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, listIds } from "./helpers.ts";

// A registered system instance forwards its call arguments to the callback after the components record and the
// entity list. The callback must see exactly the arguments the caller passed: same count, same values, nothing
// padded or dropped.

async function setup(): Promise<{ world: World; query: Query; entity: number }> {
  const tag = tagComponent("tag");
  const world = await createTestWorld([tag]);
  const entity = createEntity(world);
  world.components.addToEntity(tag, entity);
  return { world, query: new Query({ all: [tag] }), entity };
}

Deno.test("a system callback's arguments.length matches the caller's argument count", async () => {
  const { world, query, entity } = await setup();
  let seen: unknown[] = [];
  const instance = world.systems.create(
    new System<Record<string, never>, unknown[], void>({
      name: "argumentsLength",
      query,
      callback: function () {
        seen = Array.from(arguments);
      },
    }),
  );

  const calls: unknown[][] = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8]];
  for (const args of calls) {
    instance(...args);
    assertEquals(seen.length, args.length + 2, `${args.length} call args give arguments.length ${args.length + 2}`);
    assertEquals(seen.slice(2), args, `${args.length} call args are forwarded in order`);
    assertEquals(listIds(seen[1] as Parameters<typeof listIds>[0]), [entity], "The entity list comes second");
  }
  await world.destroy();
});

Deno.test("a system callback with a rest parameter receives exactly the caller's arguments", async () => {
  const { world, query } = await setup();
  let rest: unknown[] = [];
  const instance = world.systems.create(
    new System({
      name: "restParam",
      query,
      callback: (_components, _entities, ...args: unknown[]) => {
        rest = args;
      },
    }),
  );

  instance();
  assertEquals(rest, [], "No call args give an empty rest array");
  instance("a");
  assertEquals(rest, ["a"], "One call arg");
  instance("a", 2, null, false, "e");
  assertEquals(rest, ["a", 2, null, false, "e"], "Many call args");
  await world.destroy();
});

Deno.test("explicit trailing undefined arguments are forwarded, not dropped", async () => {
  const { world, query } = await setup();
  let count = -1;
  const instance = world.systems.create(
    new System<Record<string, never>, unknown[], void>({
      name: "explicitUndefined",
      query,
      callback: (_components, _entities, ...args: unknown[]) => {
        count = args.length;
      },
    }),
  );

  instance(undefined);
  assertStrictEquals(count, 1, "One explicit undefined");
  instance(1, undefined, undefined);
  assertStrictEquals(count, 3, "Trailing explicit undefineds");
  await world.destroy();
});

Deno.test("a system callback's default parameters apply only when the caller omits them", async () => {
  const { world, query } = await setup();
  let seen: unknown[] = [];
  const instance = world.systems.create(
    new System({
      name: "defaults",
      query,
      callback: (_components, _entities, dt: number = 7, scale: number = 3) => {
        seen = [dt, scale];
      },
    }),
  );

  instance();
  assertEquals(seen, [7, 3], "Both defaults apply with no call args");
  instance(1);
  assertEquals(seen, [1, 3], "The second default applies with one call arg");
  instance(1, 2);
  assertEquals(seen, [1, 2], "No defaults apply with both call args");
  await world.destroy();
});

Deno.test("a system instance returns the callback's return value", async () => {
  const { world, query } = await setup();
  const sum = world.systems.create(
    new System({
      name: "sum",
      query,
      callback: (_components, entities, a: number, b: number) => a + b + entities.count,
    }),
  );
  const marker = {};
  const identity = world.systems.create(
    new System({
      name: "identity",
      query,
      callback: (_components, _entities, value: object) => value,
    }),
  );
  const asyncSystem = world.systems.create(
    new System({
      name: "async",
      query,
      callback: async (_components, _entities, value: string) => {
        await Promise.resolve();
        return value.toUpperCase();
      },
    }),
  );

  assertStrictEquals(sum(1, 2), 4, "A computed return value");
  assertStrictEquals(identity(marker), marker, "An object return value keeps its identity");
  const pending = asyncSystem("done");
  assert(pending instanceof Promise, "An async callback's promise is returned");
  assertStrictEquals(await pending, "DONE", "The promise resolves to the callback's value");
  await world.destroy();
});

Deno.test("a system callback is called without a this value", async () => {
  const { world, query } = await setup();
  let self: unknown = "unset";
  const instance = world.systems.create(
    new System<Record<string, never>, unknown[], void>({
      name: "thisValue",
      query,
      callback: function (this: unknown) {
        self = this;
      },
    }),
  );

  instance.call({ not: "forwarded" }, 1);
  assertStrictEquals(self, undefined, "The callback's this is undefined");
  await world.destroy();
});
